#!/usr/bin/env python3
"""LOC P1 replay tool: safe read-only default, exact-ID/confirmed QStash republish only.

Requires production Supabase service secret via hidden prompt. No token is persisted
and original LINE event payload is never written to local disk or displayed.
"""
import argparse
import getpass
import json
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

PROJECT = 'qaiesdhuferechijkdhi'
SUPABASE = f'https://{PROJECT}.supabase.co'
QSTASH = 'https://qstash-eu-central-1.upstash.io'
CONSUMER = 'https://deft-cactus-e4e75f.netlify.app/api/line-webhook-qstash'


def stop(code):
    raise SystemExit('STOP: ' + code)


def request_json(url, headers, *, body=None, method=None):
    req = Request(url, data=body, headers=headers,
                  method=method or ('POST' if body is not None else 'GET'))
    try:
        with urlopen(req, timeout=30) as res:
            return res.status, json.load(res)
    except HTTPError as e:
        stop('REMOTE_HTTP_' + str(e.code))
    except (URLError, TimeoutError, OSError, ValueError) as e:
        stop('REQUEST_FAILED_' + type(e).__name__)


def headers_for_supabase(key):
    h = {'apikey': key, 'Accept': 'application/json'}
    if not key.startswith('sb_secret_'):
        h['Authorization'] = 'Bearer ' + key
    return h


def fetch_pending(key, event_id=None):
    params = {'select': 'webhook_event_id,summary_group_round_id,line_group_id,'
                        'event_timestamp,registered_at,completed_at,destination,event_payload',
              'completed_at': 'is.null', 'limit': '1000',
              'order': 'registered_at.asc'}
    if event_id is not None:
        params['webhook_event_id'] = 'eq.' + event_id
        params['limit'] = '2'
    url = SUPABASE + '/rest/v1/line_qstash_ingress_ledger?' + urlencode(params)
    _, rows = request_json(url, headers_for_supabase(key))
    if not isinstance(rows, list):
        stop('UNEXPECTED_LEDGER_SCHEMA')
    if len(rows) == 1000:
        stop('AUDIT_PAGINATION_INCOMPLETE')
    if event_id is not None and len(rows) > 1:
        stop('DUPLICATE_LEDGER_ID')
    return rows


def build_job(row):
    event = row.get('event_payload')
    event_id = row.get('webhook_event_id')
    round_id = row.get('summary_group_round_id')
    destination = row.get('destination')
    group = row.get('line_group_id')
    try:
        epoch_ms = int(event['timestamp'])
        from datetime import datetime, timezone
        saved_epoch = datetime.fromisoformat(
            row['event_timestamp'].replace('Z', '+00:00'))
        saved_ms = round(saved_epoch.timestamp() * 1000)
    except (ValueError, TypeError, KeyError, AttributeError):
        stop('LEDGER_PAYLOAD_TIMESTAMP_INVALID')
    if (not event_id or not round_id or not destination or not group
        or not isinstance(event, dict)
        or event.get('webhookEventId') != event_id
        or event.get('source', {}).get('groupId') != group
        or event.get('source', {}).get('type') != 'group'
        or event.get('type') != 'message'
        or event.get('message', {}).get('type') not in ('text', 'image')
        or epoch_ms != saved_ms):
        stop('LEDGER_EVENT_IDENTITY_INVALID')
    return {'destination': destination, 'event': event,
            'admission': {'round_id': round_id, 'event_timestamp': epoch_ms,
                          'line_group_id': group, 'webhook_event_id': event_id},
            'ingress_ledger_v1': True}


def main():
    parser = argparse.ArgumentParser(
        description='Read-only audit or explicitly confirmed one-event QStash recovery.')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--audit', action='store_true')
    group.add_argument('--replay', metavar='WEBHOOK_EVENT_ID')
    args = parser.parse_args()
    print('===== LOC P1 RECOVERY — EXACT PROJECT / REGION PIN =====')
    print('SUPABASE_PROJECT=' + PROJECT + '; QSTASH_REGION=EU')
    print('DEFAULT=GET_ONLY; NO_SOURCE_MUTATION; NO_DB_MUTATION')
    key = getpass.getpass('Supabase PRODUCTION service-role/secret key (hidden): ').strip()
    if not key:
        stop('SUPABASE_KEY_MISSING')
    rows = fetch_pending(key, args.replay)
    if not args.replay:
        recoverable = sum(1 for row in rows if row.get('event_payload') and row.get('destination'))
        print('PENDING_LEDGER_COUNT=' + str(len(rows)))
        print('RECOVERABLE_WITH_PAYLOAD=' + str(recoverable))
        print('MISSING_PAYLOAD=' + str(len(rows) - recoverable))
        if rows:
            print('OLDEST_REGISTERED_AT=' + str(rows[0].get('registered_at')))
            print('NEWEST_REGISTERED_AT=' + str(rows[-1].get('registered_at')))
        print('CLASSIFICATION=LOC_P1_LEDGER_READONLY_AUDIT_COMPLETE')
        print('API_METHODS=GET_ONLY; QSTASH_PUBLISH=NO; LINE_SEND=NO; DB_MUTATION=NO')
        return
    if len(rows) != 1:
        stop('NO_EXACT_PENDING_LEDGER_ROW')
    row = rows[0]
    job = build_job(row)
    event_id = row['webhook_event_id']
    print('RECOVERY_EVENT_ID=' + event_id)
    print('RECOVERY_MESSAGE_TYPE=' + job['event']['message']['type'])
    print('RECOVERY_ROUND_ID=' + row['summary_group_round_id'])
    print('NOTICE: Will publish exactly one idempotent job to PINNED QStash EU endpoint.')
    print('NOTICE: May trigger LINE image download/OCR and Supabase operational writes.')
    print('NOTICE: Never mark a Ledger row complete manually; QStash Consumer confirms it.')
    expected = 'REPLAY ' + event_id
    confirmation = input('Type exactly ' + expected + ' : ').strip()
    if confirmation != expected:
        stop('CONFIRMATION_MISMATCH')
    token = getpass.getpass('QStash EU TOKEN (hidden): ').strip()
    if not token:
        stop('QSTASH_TOKEN_MISSING')
    data = json.dumps(job, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    hdr = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
           'Upstash-Deduplication-Id': 'line-webhook-' + event_id,
           'Upstash-Flow-Control-Key': 'line-webhook-ingress-v1',
           'Upstash-Flow-Control-Value': 'parallelism=2, rate=5, period=1s',
           'Upstash-Retries': '5',
           'Upstash-Retry-Delay': '60000 * (1 + retried)',
           'Upstash-Label': 'line-webhook-ingress-v1'}
    status, response = request_json(
        QSTASH + '/v2/publish/' + CONSUMER, hdr, body=data)
    if status not in (200, 201, 202) or not isinstance(response, dict) \
       or not response.get('messageId'):
        stop('QSTASH_PUBLISH_ACK_UNVERIFIED')
    print('QSTASH_PUBLISH_ACK=YES')
    print('QSTASH_DEDUPLICATED=' + str(bool(response.get('deduplicated', False))))
    print('CLASSIFICATION=LOC_P1_EXACT_EVENT_REPLAY_ACCEPTED')
    print('NEXT=Re-run --audit to verify Consumer eventually clears pending row.')


if __name__ == '__main__':
    main()
