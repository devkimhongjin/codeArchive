export type SupportCategory = 'BUG' | 'QUESTION' | 'DATA_REQUEST'
export type SupportStatus = 'OPEN' | 'ANSWERED' | 'CLOSED'
export type SupportAccess = { admin: boolean; closedRetentionDays: number }
export type SupportInquirySummary = { id: number; category: SupportCategory; title: string; status: SupportStatus; createdAt: string; updatedAt: string; closedAt: string | null }
export type SupportMessage = { id: number; authorRole: 'USER' | 'ADMIN'; body: string; createdAt: string }
export type SupportInquiry = { inquiry: SupportInquirySummary; messages: SupportMessage[]; admin: boolean }
export type SupportPage = { items: SupportInquirySummary[]; page: number; size: number; total: number; hasMore: boolean }
