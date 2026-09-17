export type PulseCardType = 'ENDORSE' | 'RELEASE' | 'PARTS_REQUEST' | 'CABINET_QUERY' | 'STATUS_CHECK' | 'SHIFT_HANDOVER' | 'ALERT';
export type PulseTargetRole = 'ENGR' | 'PMG' | 'CSO' | 'Admin' | 'ALL';
export type PulseStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface EndorsePayload { arNumber: string; deviceModel: string; faultDescription: string; priority: 'NORMAL' | 'URGENT'; assignedEngineerName: string; assignedEngineerId: number; waitingHours: number; cabinetLocation?: string }
export interface ReleasePayload { arNumber: string; customerName: string; releasedByEmployeeId: string; releasedByName: string; cabinetLocation: string }
export interface PartsRequestPayload { arNumber: string; partNumber: string; partDescription: string; urgency: 'NORMAL' | 'URGENT'; notes?: string; requestedByName: string; status: 'PENDING' | 'FULFILLED' | 'DECLINED'; respondedByName?: string; respondedAt?: string }
export interface CabinetQueryPayload { arNumber?: string; cabinetNumber?: string; resolvedArNumber?: string; resolvedDeviceModel?: string; resolvedStatus?: string; resolvedCabinet?: string; resolvedStoredBy?: string; resolvedStoredAt?: string }
export interface StatusCheckPayload { arNumber: string; timeline: Array<{ timestamp: string; source: 'FRONTLINE' | 'STORAGE' | 'ENDORSEMENT' | 'PARTS' | 'PULSE'; event: string; actor?: string }> }
export interface ShiftHandoverPayload { openEndorsements: Array<{ arNumber: string; engineer: string; waitingHours: number }>; pendingPartsRequests: Array<{ arNumber: string; partNumber: string }>; unitsInCabinet: Array<{ arNumber: string; cabinet: string }>; totalOpen: number }
export interface AlertPayload { message: string; severity: 'INFO' | 'WARNING' | 'CRITICAL' }
export type PulsePayload = EndorsePayload | ReleasePayload | PartsRequestPayload | CabinetQueryPayload | StatusCheckPayload | ShiftHandoverPayload | AlertPayload;
export interface PulseMessage { id: number; type: PulseCardType; ar_number: string | null; payload: PulsePayload; posted_by: number | null; target_role: PulseTargetRole; target_user_id: number | null; status: PulseStatus; created_at: Date | string; updated_at: Date | string; isAcknowledged?: boolean; }
