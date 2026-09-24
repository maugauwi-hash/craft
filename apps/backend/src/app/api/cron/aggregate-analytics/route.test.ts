import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAggregate = vi.fn();
const mockRecordSuccess = vi.fn();
const mockRecordFailure = vi.fn();
const mockValidateCronSignature = vi.fn().mockReturnValue(true);

vi.mock('@/services/analytics-aggregation.service', () => ({
    analyticsAggregationService: {
        aggregate: mockAggregate,
    },
}));

vi.mock('@/services/cron-failure-tracker.service', () => ({
    cronFailureTrackerService: {
        recordSuccess: mockRecordSuccess,
        recordFailure: mockRecordFailure,
    },
}));

vi.mock('@/lib/api/cron-auth', () => ({
    withCronAuth: (handler: any) => handler,
}));

function makeRequest(authHeader?: string) {
    const headers: Record<string, string> = {};
    if (authHeader !== undefined) {
        headers['authorization'] = authHeader;
    }
    return new NextRequest('http://localhost/api/cron/aggregate-analytics', { headers });
}

describe('GET /api/cron/aggregate-analytics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAggregate.mockResolvedValue({ bucketsWritten: 10 });
    });

    describe('success tracking', () => {
        it('calls recordSuccess when aggregation succeeds', async () => {
            mockAggregate.mockResolvedValue({ bucketsWritten: 5 });
            const { GET } = await import('./route');
            await GET(makeRequest());
            expect(mockRecordSuccess).toHaveBeenCalledWith('aggregate-analytics');
            expect(mockRecordFailure).not.toHaveBeenCalled();
        });

        it('returns 200 with success response and success tracking on success', async () => {
            const { GET } = await import('./route');
            const res = await GET(makeRequest());
            expect(res.status).toBe(200);
            expect(mockRecordSuccess).toHaveBeenCalled();

            const body = await res.json();
            expect(body).toHaveProperty('success', true);
        });

        it('returns both hourly and daily aggregation results', async () => {
            mockAggregate
                .mockResolvedValueOnce({ bucketsWritten: 24 })
                .mockResolvedValueOnce({ bucketsWritten: 1 });

            const { GET } = await import('./route');
            const res = await GET(makeRequest());
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body).toHaveProperty('hourly.bucketsWritten', 24);
            expect(body).toHaveProperty('daily.bucketsWritten', 1);
        });
    });

    describe('failure tracking', () => {
        it('calls recordFailure with error message when aggregation throws', async () => {
            mockAggregate.mockRejectedValue(new Error('DB connection timeout'));
            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(500);
            expect(mockRecordFailure).toHaveBeenCalledWith('aggregate-analytics', 'DB connection timeout');
            expect(mockRecordSuccess).not.toHaveBeenCalled();
        });

        it('returns 500 with error response when aggregation throws', async () => {
            mockAggregate.mockRejectedValue(new Error('Service unavailable'));
            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body).toHaveProperty('error', 'Service unavailable');
        });

        it('uses fallback error message when thrown value has no message property', async () => {
            mockAggregate.mockRejectedValue({});
            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(500);
            expect(mockRecordFailure).toHaveBeenCalledWith('aggregate-analytics', 'Aggregation failed');
        });

        it('records failure only once even if both hourly and daily fail', async () => {
            mockAggregate
                .mockRejectedValueOnce(new Error('hourly failed'))
                .mockResolvedValueOnce({ bucketsWritten: 1 });

            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(500);
            expect(mockRecordFailure).toHaveBeenCalledTimes(1);
        });
    });
});
