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
        GetObjectCommand: jest.fn((input) => ({ type: "get", input })),
        PutObjectCommand: jest.fn((input) => ({ type: "put", input })),
        ListObjectsV2Command: jest.fn((input) => ({ type: "list", input })),
        __NoSuchKeyError: NoSuchKeyError,
    };
});

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const { GroupRegistry } = require("../src/notifications/groupRegistry");
const { __NoSuchKeyError } = require("@aws-sdk/client-s3");

function streamFromString(str) {
    // Minimal async-iterable stub mimicking an S3 Body stream.
    return {
        async *[Symbol.asyncIterator]() {
            yield Buffer.from(str, "utf8");
        },
    };
}

describe("GroupRegistry", () => {
    const awsConfig = {
        region: "us-east-1",
        accessKeyId: "test",
        secretAccessKey: "test",
        bucketName: "test-bucket",
        keyPrefix: "posthog-insights-engine",
    };

    afterEach(() => {
        mockSend.mockReset();
    });

    it("starts with an empty registry when the S3 object doesn't exist yet", async () => {
        mockSend.mockRejectedValueOnce(new __NoSuchKeyError());
        const registry = new GroupRegistry(awsConfig);

        const groups = await registry.listGroups();
        expect(groups).toEqual([]);
    });

    it("rejects a non-numeric chatId", async () => {
        mockSend.mockRejectedValueOnce(new __NoSuchKeyError());
        const registry = new GroupRegistry(awsConfig);

        await expect(registry.registerGroup("not-a-number", "Founder Group", "founder")).rejects.toThrow(
            /chatId must be numeric/
        );
    });

    it("rejects an unsafe group name", async () => {
        mockSend.mockRejectedValueOnce(new __NoSuchKeyError());
        const registry = new GroupRegistry(awsConfig);

        await expect(registry.registerGroup("-100", "../etc/passwd", "founder")).rejects.toThrow(
            /groupName must be/
        );
    });

    it("rejects an invalid report type", async () => {
        mockSend.mockRejectedValueOnce(new __NoSuchKeyError());
        const registry = new GroupRegistry(awsConfig);

        await expect(registry.registerGroup("-100", "Founder Group", "attacker")).rejects.toThrow(
            /Invalid reportType/
        );
    });

    it("registers a group and persists it via PutObjectCommand", async () => {
        mockSend.mockRejectedValueOnce(new __NoSuchKeyError()); // initial load
        mockSend.mockResolvedValueOnce({}); // put

        const registry = new GroupRegistry(awsConfig);
        const result = await registry.registerGroup("-100123", "Founder Group", "founder");

        expect(result.groupName).toBe("Founder Group");
        expect(result.reportType).toBe("founder");
        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("getGroup returns the registered entry from the cache after registering", async () => {
        mockSend.mockRejectedValueOnce(new __NoSuchKeyError());
        mockSend.mockResolvedValueOnce({});

        const registry = new GroupRegistry(awsConfig);
        await registry.registerGroup("-100123", "Founder Group", "founder");

        const group = await registry.getGroup("-100123");
        expect(group).toMatchObject({ groupName: "Founder Group", reportType: "founder" });
    });

    it("getGroup returns null for an unregistered chat", async () => {
        mockSend.mockResolvedValueOnce({ Body: streamFromString("{}") });

        const registry = new GroupRegistry(awsConfig);
        const group = await registry.getGroup("-999");
        expect(group).toBeNull();
    });

    it("loads an existing registry from S3 on first access", async () => {
        const existing = JSON.stringify({
            "-555": { groupName: "Marketing", reportType: "marketing", updatedAt: "2026-01-01T00:00:00.000Z" },
        });
        mockSend.mockResolvedValueOnce({ Body: streamFromString(existing) });

        const registry = new GroupRegistry(awsConfig);
        const group = await registry.getGroup("-555");

        expect(group).toEqual({
            groupName: "Marketing",
            reportType: "marketing",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
    });
});
