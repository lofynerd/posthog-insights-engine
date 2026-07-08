const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
    class NoSuchKeyError extends Error {
        constructor() {
            super("NoSuchKey");
            this.name = "NoSuchKey";
        }
    }
    return {
        S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
        PutObjectCommand: jest.fn((input) => ({ type: "put", input })),
        GetObjectCommand: jest.fn((input) => ({ type: "get", input })),
        ListObjectsV2Command: jest.fn((input) => ({ type: "list", input })),
        __NoSuchKeyError: NoSuchKeyError,
    };
});

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const { S3SnapshotService } = require("../src/storage/s3Snapshot.service");
const { __NoSuchKeyError } = require("@aws-sdk/client-s3");

function streamFromString(str) {
    return {
        async *[Symbol.asyncIterator]() {
            yield Buffer.from(str, "utf8");
        },
    };
}

describe("S3SnapshotService path safety", () => {
    const awsConfig = {
        region: "us-east-1",
        accessKeyId: "test",
        secretAccessKey: "test",
        bucketName: "test-bucket",
        keyPrefix: "posthog-insights-engine",
    };

    afterEach(() => jest.clearAllMocks());

    it("rejects path traversal in groupName", async () => {
        const service = new S3SnapshotService(awsConfig);
        await expect(
            service.putSnapshot({
                groupName: "../../etc",
                reportType: "founder",
                dateKey: "2026-07-08",
                payload: {},
            })
        ).rejects.toThrow(/Invalid groupName/);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("rejects an absolute path in groupName", async () => {
        const service = new S3SnapshotService(awsConfig);
        await expect(
            service.putSnapshot({
                groupName: "/etc/passwd",
                reportType: "founder",
                dateKey: "2026-07-08",
                payload: {},
            })
        ).rejects.toThrow(/Invalid groupName/);
    });

    it("rejects an invalid reportType", async () => {
        const service = new S3SnapshotService(awsConfig);
        await expect(
            service.putSnapshot({
                groupName: "Founder Group",
                reportType: "../secrets",
                dateKey: "2026-07-08",
                payload: {},
            })
        ).rejects.toThrow(/Invalid reportType/);
    });

    it("rejects an oversized groupName", async () => {
        const service = new S3SnapshotService(awsConfig);
        await expect(
            service.putSnapshot({
                groupName: "a".repeat(200),
                reportType: "founder",
                dateKey: "2026-07-08",
                payload: {},
            })
        ).rejects.toThrow(/Invalid groupName/);
    });

    it("builds the expected key for valid input and stores the snapshot", async () => {
        mockSend.mockResolvedValueOnce({});
        const service = new S3SnapshotService(awsConfig);

        const key = await service.putSnapshot({
            groupName: "Founder Group",
            reportType: "founder",
            dateKey: "2026-07-08",
            payload: { hello: "world" },
        });

        expect(key).toBe("posthog-insights-engine/Founder Group/founder/2026-07-08.json");
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("rejects an oversized snapshot payload before calling S3", async () => {
        const service = new S3SnapshotService(awsConfig);
        const huge = { blob: "x".repeat(6 * 1024 * 1024) };

        await expect(
            service.putSnapshot({
                groupName: "Founder Group",
                reportType: "founder",
                dateKey: "2026-07-08",
                payload: huge,
            })
        ).rejects.toThrow(/exceeds maximum allowed size/);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("getSnapshot returns null when the object doesn't exist", async () => {
        mockSend.mockRejectedValueOnce(new __NoSuchKeyError());
        const service = new S3SnapshotService(awsConfig);

        const result = await service.getSnapshot({
            groupName: "Founder Group",
            reportType: "founder",
            dateKey: "2026-07-08",
        });

        expect(result).toBeNull();
    });

    it("getSnapshot parses and returns stored JSON", async () => {
        mockSend.mockResolvedValueOnce({ Body: streamFromString('{"visitors":42}') });
        const service = new S3SnapshotService(awsConfig);

        const result = await service.getSnapshot({
            groupName: "Founder Group",
            reportType: "founder",
            dateKey: "2026-07-08",
        });

        expect(result).toEqual({ visitors: 42 });
    });

    it("listSnapshotDates extracts and sorts dates, most recent first", async () => {
        mockSend.mockResolvedValueOnce({
            Contents: [
                { Key: "posthog-insights-engine/Founder Group/founder/2026-07-01.json" },
                { Key: "posthog-insights-engine/Founder Group/founder/2026-07-08.json" },
                { Key: "posthog-insights-engine/Founder Group/founder/not-a-date.json" },
            ],
        });
        const service = new S3SnapshotService(awsConfig);

        const dates = await service.listSnapshotDates({ groupName: "Founder Group", reportType: "founder" });

        expect(dates).toEqual(["2026-07-08", "2026-07-01"]);
    });
});
