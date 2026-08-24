# IMAGE / OCR v1 setup

## New Netlify environment variables

Add these values in Netlify Project configuration → Environment variables:

- `LINE_CHANNEL_ACCESS_TOKEN`
  - From the same LINE Messaging API channel used by the webhook.
  - Used only on the server to download image content from LINE.
- `GEMINI_API_KEY`
  - Create/copy from Google AI Studio.
  - Server-side only.
- `GEMINI_MODEL`
  - Optional.
  - Recommended initial value: `gemini-3.7-flash`

Do not place secrets in GitHub or frontend code.

## Supabase migration

Run:

`supabase/migrations/202608240002_add_image_ocr.sql`

This adds OCR metadata to `messages` without storing image binaries.

## Image processing flow

1. LINE webhook receives image `message.id`.
2. Netlify downloads the image from LINE's Get content endpoint using `LINE_CHANNEL_ACCESS_TOKEN`.
3. Image bytes are sent inline to Gemini for transcription only.
4. Gemini must preserve order syntax and mark uncertain characters with `?`.
5. If OCR contains `?`, message goes to `REVIEW` with `OCR_UNCERTAIN`.
6. Otherwise OCR text goes through the same deterministic Parser v1 used for text messages.
7. Parsed items go to `order_items`; parser failures go to `review_items`.
8. Image bytes are never written to Supabase.
9. On LINE unsend, stored OCR text is cleared while derived order quantities remain flagged as unsent for reconciliation.

## First test image

Use a clean screenshot containing only:

```
AB
01
02
03=20
```

Expected `order_items`: 6 rows (A01,A02,A03,B01,B02,B03), quantity 20.

Then test a deliberately unclear image. Expected result: `review_items` with `OCR_UNCERTAIN` or `IMAGE_OCR_FAILED`.
