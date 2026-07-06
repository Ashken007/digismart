const fs = require("fs");
const http = require("http");
const path = require("path");
const nodemailer = require("nodemailer");
const Busboy = require("busboy");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

const rootDir = __dirname;
const envPath = path.join(rootDir, ".env");
const MAX_REQUEST_BODY_SIZE = 15 * 1024 * 1024;

function loadEnvFile() {
    if (!fs.existsSync(envPath)) {
        return;
    }

    fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
        const trimmedLine = line.trim();
        const separatorIndex = trimmedLine.indexOf("=");

        if (!trimmedLine || trimmedLine.startsWith("#") || separatorIndex === -1) {
            return;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        const value = trimmedLine.slice(separatorIndex + 1).trim();

        if (!process.env[key]) {
            process.env[key] = value;
        }
    });
}

function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();

    return {
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".ico": "image/x-icon"
    }[extension] || "application/octet-stream";
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeRecipientList(value) {
    return String(value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function isValidEmailList(value) {
    const entries = normalizeRecipientList(value);

    return entries.length > 0 && entries.every(isValidEmail);
}

function normalizeAttachmentList(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((attachment) => {
            if (!attachment || typeof attachment !== "object") {
                return null;
            }

            const filename = String(attachment.filename || attachment.name || "attachment").trim() || "attachment";
            const content = attachment.content;
            const contentType = String(attachment.contentType || attachment.type || "application/octet-stream");

            if (!content) {
                return null;
            }

            return {
                filename,
                content: Buffer.isBuffer(content) ? content : Buffer.from(String(content), "base64"),
                contentType
            };
        })
        .filter(Boolean);
}

function parseMultipartBody(request) {
    return new Promise((resolve, reject) => {
        const fields = {};
        const attachments = [];
        let pendingFiles = 0;
        let parserClosed = false;
        let settled = false;

        function finish() {
            if (!settled && parserClosed && pendingFiles === 0) {
                settled = true;
                resolve({ fields, attachments });
            }
        }

        let parser;

        try {
            parser = Busboy({
                headers: request.headers,
                limits: {
                    fileSize: 10 * 1024 * 1024,
                    files: 10,
                    parts: 40
                }
            });
        } catch (error) {
            reject(error);
            return;
        }

        parser.on("field", (name, value) => {
            fields[name] = value;
        });

        parser.on("file", (name, file, info) => {
            const chunks = [];
            let truncated = false;
            pendingFiles += 1;

            file.on("data", (chunk) => {
                chunks.push(chunk);
            });

            file.on("limit", () => {
                truncated = true;
                file.resume();
            });

            file.on("error", (error) => {
                if (!settled) {
                    settled = true;
                    reject(error);
                }
            });

            file.on("close", () => {
                pendingFiles -= 1;

                if (settled) {
                    return;
                }

                if (truncated) {
                    settled = true;
                    reject(new Error(`Attachment "${info.filename || "attachment"}" is too large.`));
                    return;
                }

                attachments.push({
                    filename: info.filename || "attachment",
                    content: Buffer.concat(chunks),
                    contentType: info.mimeType || "application/octet-stream"
                });

                finish();
            });
        });

        parser.on("error", (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });

        parser.on("close", () => {
            parserClosed = true;
            finish();
        });

        request.pipe(parser);
    });
}

async function parseSendEmailPayload(request) {
    const contentType = String(request.headers["content-type"] || "").toLowerCase();

    if (contentType.includes("multipart/form-data")) {
        const formData = await parseMultipartBody(request);

        return {
            to: formData.fields.to || "",
            cc: formData.fields.cc || "",
            bcc: formData.fields.bcc || "",
            subject: formData.fields.subject || "",
            message: formData.fields.message || "",
            attachments: formData.attachments
        };
    }

    return readJsonBody(request);
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", (chunk) => {
            body += chunk;

            if (body.length > MAX_REQUEST_BODY_SIZE) {
                request.destroy();
                reject(new Error("Request body is too large."));
            }
        });

        request.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch (error) {
                reject(new Error("Invalid JSON body."));
            }
        });
    });
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(payload));
}

function getErrorMessage(error) {
    if (!error) {
        return "";
    }

    if (Array.isArray(error.errors) && error.errors.length) {
        const nestedErrors = error.errors.map(getErrorMessage).filter(Boolean);
        return [error.message, nestedErrors.join("; ")].filter(Boolean).join(": ");
    }

    if (error.cause) {
        const causeMessage = getErrorMessage(error.cause);
        return [error.message, causeMessage].filter(Boolean).join(": ");
    }

    return error.message || String(error);
}

function parseBooleanEnv(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    return !/^(false|0|no)$/i.test(String(value).trim());
}

function normalizeLimit(value, fallback, maximum) {
    const parsedValue = Number(value);

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return fallback;
    }

    return Math.min(Math.floor(parsedValue), maximum);
}

function buildPreview(text) {
    return String(text || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
}

function extractEmailAddress(value) {
    const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0] : "";
}

function sanitizeAttachmentFilename(value) {
    return String(value || "attachment")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .trim() || "attachment";
}

function serializeAttachment(attachment) {
    if (!attachment || !Buffer.isBuffer(attachment.content)) {
        return null;
    }

    return {
        filename: sanitizeAttachmentFilename(attachment.filename),
        contentType: attachment.contentType || "application/octet-stream",
        size: attachment.size || attachment.content.length,
        content: attachment.content.toString("base64")
    };
}

function getImapConfig() {
    const port = Number(process.env.IMAP_PORT || 993);

    return {
        host: process.env.IMAP_HOST || process.env.SMTP_HOST,
        port,
        secure: parseBooleanEnv(process.env.IMAP_SECURE, port === 993),
        user: process.env.IMAP_USER || process.env.SMTP_USER,
        pass: process.env.IMAP_PASS || process.env.SMTP_PASS,
        mailbox: process.env.IMAP_MAILBOX || "INBOX"
    };
}

async function fetchInboxMessages(limit) {
    const config = getImapConfig();

    if (!config.host || !config.user || !config.pass) {
        throw new Error("IMAP settings are missing. Create a .env file with IMAP_HOST, IMAP_USER, and IMAP_PASS.");
    }

    const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass
        }
    });

    let lock = null;

    try {
        await client.connect();
        lock = await client.getMailboxLock(config.mailbox);

        const totalMessages = client.mailbox && client.mailbox.exists ? client.mailbox.exists : 0;

        if (!totalMessages) {
            return [];
        }

        const start = Math.max(1, totalMessages - limit + 1);
        const messages = [];

        for await (const message of client.fetch(`${start}:*`, {
            envelope: true,
            flags: true,
            source: true
        })) {
            const parsed = await simpleParser(message.source);
            const attachments = Array.isArray(parsed.attachments) ? parsed.attachments.map(serializeAttachment).filter(Boolean) : [];

            messages.push({
                uid: message.uid,
                subject: parsed.subject || (message.envelope && message.envelope.subject) || "(no subject)",
                from: (parsed.from && parsed.from.text) || (message.envelope && message.envelope.from && message.envelope.from.text) || "Unknown sender",
                fromEmail: (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || extractEmailAddress((parsed.from && parsed.from.text) || (message.envelope && message.envelope.from && message.envelope.from.text) || ""),
                to: (parsed.to && parsed.to.text) || (message.envelope && message.envelope.to && message.envelope.to.text) || "",
                date: (parsed.date || message.internalDate || new Date()).toLocaleString(),
                preview: buildPreview(parsed.text || parsed.html || ""),
                body: String(parsed.text || parsed.html || ""),
                attachments: attachments,
                unread: !(Array.isArray(message.flags) && message.flags.includes("\\Seen"))
            });
        }

        return messages.reverse();
    } catch (error) {
        const details = getErrorMessage(error);
        throw new Error(details ? `Unable to load inbox: ${details}` : "Unable to load inbox.");
    } finally {
        if (lock) {
            lock.release();
        }

        try {
            await client.logout();
        } catch (error) {
            // Ignore logout errors during cleanup.
        }
    }
}

async function markInboxMessageSeen(uid) {
    const config = getImapConfig();
    const messageUid = Number(uid);

    if (!config.host || !config.user || !config.pass) {
        throw new Error("IMAP settings are missing. Create a .env file with IMAP_HOST, IMAP_USER, and IMAP_PASS.");
    }

    if (!Number.isFinite(messageUid) || messageUid <= 0) {
        throw new Error("Invalid inbox message id.");
    }

    const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass
        }
    });

    let lock = null;

    try {
        await client.connect();
        lock = await client.getMailboxLock(config.mailbox);
        await client.messageFlagsAdd(messageUid, ["\\Seen"], { uid: true });
        return true;
    } catch (error) {
        const details = getErrorMessage(error);
        throw new Error(details ? `Unable to mark message as read: ${details}` : "Unable to mark message as read.");
    } finally {
        if (lock) {
            lock.release();
        }

        try {
            await client.logout();
        } catch (error) {
            // Ignore logout errors during cleanup.
        }
    }
}

async function sendEmail(request, response) {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;
    const payload = await parseSendEmailPayload(request);
    const to = String(payload.to || "").trim();
    const cc = String(payload.cc || "").trim();
    const bcc = String(payload.bcc || "").trim();
    const subject = String(payload.subject || "").trim();
    const message = String(payload.message || "").trim();
    const attachments = normalizeAttachmentList(payload.attachments);

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !smtpFrom) {
        sendJson(response, 500, {
            error: "SMTP settings are missing. Create a .env file from .env.example."
        });
        return;
    }

    if (!isValidEmailList(to)) {
        sendJson(response, 400, { error: "Enter valid email id format." });
        return;
    }

    if (cc && !isValidEmailList(cc)) {
        sendJson(response, 400, { error: "Enter valid Cc email id format." });
        return;
    }

    if (bcc && !isValidEmailList(bcc)) {
        sendJson(response, 400, { error: "Enter valid Bcc email id format." });
        return;
    }

    if (!subject || !message) {
        sendJson(response, 400, { error: "Subject and message are required." });
        return;
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });

    await transporter.sendMail({
        from: smtpFrom,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        text: message,
        replyTo: smtpFrom,
        attachments
    });

    sendJson(response, 200, { ok: true });
}

function serveStatic(request, response) {
    const requestPath = decodeURIComponent(request.url.split("?")[0]);
    const relativePath = requestPath === "/" ? "CRE - DIGISMART.html" : requestPath.slice(1);
    const filePath = path.resolve(rootDir, relativePath);

    if (!filePath.startsWith(rootDir)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            response.writeHead(404);
            response.end("Not found");
            return;
        }

        response.writeHead(200, {
            "Content-Type": getContentType(filePath)
        });
        response.end(content);
    });
}

loadEnvFile();

const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/send-email") {
        try {
            await sendEmail(request, response);
        } catch (error) {
            sendJson(response, 500, {
                error: getErrorMessage(error) || "Unable to send email."
            });
        }
        return;
    }

    if (request.method === "GET" && request.url && request.url.startsWith("/api/inbox")) {
        try {
            const requestUrl = new URL(request.url, "http://localhost");
            const limit = normalizeLimit(requestUrl.searchParams.get("limit"), 20, 50);
            const messages = await fetchInboxMessages(limit);

            sendJson(response, 200, {
                ok: true,
                messages
            });
        } catch (error) {
            sendJson(response, 500, {
                error: getErrorMessage(error) || "Unable to load inbox."
            });
        }
        return;
    }

    if (request.method === "POST" && request.url === "/api/inbox/seen") {
        try {
            const payload = await readJsonBody(request);
            const uid = payload && payload.uid;

            await markInboxMessageSeen(uid);
            sendJson(response, 200, { ok: true });
        } catch (error) {
            sendJson(response, 500, {
                error: getErrorMessage(error) || "Unable to mark message as read."
            });
        }
        return;
    }

    if (request.method === "GET") {
        serveStatic(request, response);
        return;
    }

    response.writeHead(405);
    response.end("Method not allowed");
});

const port = Number(process.env.PORT || 3000);

server.listen(port, () => {
    console.log(`DIGISMART server running at http://localhost:${port}`);
});
