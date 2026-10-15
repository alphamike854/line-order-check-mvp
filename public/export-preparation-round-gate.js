// Export Preparation browser-only gate. Never reads/writes the database.
// Dashboard current_rounds is authoritative only in NORMAL mode.
export function exportPreparationReadGate(dashboard, rawGroupId) {
  const groupId = String(rawGroupId ?? '').trim().toUpperCase();
  if (!groupId || groupId === 'ALL') {
    return { request: false, status: 'เลือกกลุ่มสรุป',
      message: 'เลือกกลุ่มสรุปด้านบนเพื่อดูยอดเตรียมส่งออก' };
  }
  if (!dashboard || dashboard.incident_mode === true ||
      dashboard.data_unavailable === true || !Array.isArray(dashboard.current_rounds)) {
    return { request: false, status: 'ยังไม่พร้อม',
      message: 'ยังไม่สามารถยืนยันสถานะรอบได้ กรุณาอัปเดต Dashboard' };
  }
  if (!dashboard.settlement_session?.id) {
    return { request: false, status: 'ยังไม่มีรอบเปิด',
      message: 'ไม่มี Settlement Session ที่เปิดอยู่' };
  }
  const dashboardGroup = String(dashboard.selected_summary_group ?? '').toUpperCase();
  if (dashboardGroup && dashboardGroup !== groupId) {
    return { request: false, status: 'กำลังอัปเดต',
      message: 'รอข้อมูล Dashboard ของกลุ่มสรุปที่เลือก' };
  }
  const rounds = dashboard.current_rounds.filter(row =>
    String(row?.summary_group_id ?? '').toUpperCase() === groupId);
  const sessionId = String(dashboard.settlement_session.id);
  if (rounds.some(row => row.status === 'OPEN' &&
      String(row.settlement_session_id ?? '') === sessionId)) {
    return { request: true };
  }
  if (rounds.some(row => row.status === 'CLOSED' &&
      String(row.settlement_session_id ?? '') === sessionId)) {
    return { request: false, status: 'ปิดรอบแล้ว',
      message: 'กลุ่มสรุปนี้ปิดรอบแล้ว · ข้อมูลเตรียมส่งออกใช้ได้เฉพาะรอบที่เปิดอยู่' };
  }
  return { request: false, status: 'ยังไม่มีรอบเปิด',
    message: 'ไม่พบรอบที่เปิดอยู่ของกลุ่มสรุปนี้ใน Settlement Session ปัจจุบัน' };
}

// Defensive handling for a round closing between the Dashboard snapshot and GET.
export function exportPreparationReadConflict(errorCode) {
  if (errorCode === 'SUMMARY_GROUP_ROUND_NOT_OPEN') {
    return { status: 'ปิดรอบแล้ว',
      message: 'รอบของกลุ่มสรุปนี้ไม่เปิดอยู่แล้ว · กรุณาอัปเดต Dashboard หลังเปิดรอบใหม่' };
  }
  if (errorCode === 'SETTLEMENT_NOT_OPEN') {
    return { status: 'ยังไม่มีรอบเปิด',
      message: 'Settlement Session ไม่เปิดอยู่แล้ว · กรุณาอัปเดต Dashboard' };
  }
  return null;
}
