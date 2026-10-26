// Candidate only; no write methods.
import {codeAuditRead} from '../../src/lib/code-audit-v02-service.mjs';
export default req => codeAuditRead(req,'summary');
export const config = {path:'/api/code-audit-v02-summary',region:'sin'};
