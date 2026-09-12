require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const visitors = [];
console.log("ADMIN_KEY length:", (process.env.ADMIN_KEY || "").trim().length);

app.use(cors());

app.use(
    express.json({
        limit: "50mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "50mb"
    })
);

// =====================================
// DIRECTORIES
// =====================================

const uploadDir = path.join(__dirname, "uploads");
const tempDir = path.join(__dirname, "temp");

fs.mkdirSync(uploadDir, {
    recursive: true
});

fs.mkdirSync(tempDir, {
    recursive: true
});

// =====================================
// MULTER UPLOAD CONFIGURATION
// =====================================

const storage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },

    filename: function (req, file, cb) {

        const extension =
            path.extname(file.originalname).toLowerCase();

        const filename =
            Date.now() +
            "-" +
            Math.random()
                .toString(36)
                .substring(2) +
            extension;

        cb(null, filename);
    }

});

const upload = multer({

    storage: storage,

    limits: {

        fileSize: 20 * 1024 * 1024,

        files: 20

    },

    fileFilter: function (req, file, cb) {

        const allowedTypes = [
            "image/jpeg",
            "image/png"
        ];

        if (allowedTypes.includes(file.mimetype)) {

            cb(null, true);

        } else {

            cb(
                new Error(
                    "Only JPG and PNG images are allowed."
                )
            );

        }

    }

});

// =====================================
// HEALTH CHECK
// =====================================

app.get("/api/health", function (req, res) {

    res.json({

        success: true,

        message: "PDF Maker Backend is running",

        status: "online"

    });

});

// =====================================
// IMAGES → PDF
// =====================================

app.post(
    "/api/pdf/images",
    upload.array("images", 20),

    async function (req, res) {

        const uploadedFiles = [];
        let outputPath = null;

        try {

            // -----------------------------
            // Check uploaded files
            // -----------------------------

            if (
                !req.files ||
                req.files.length === 0
            ) {

                return res.status(400).json({

                    success: false,

                    message: "No images uploaded."

                });

            }

            uploadedFiles.push(
                ...req.files.map(
                    function (file) {
                        return file.path;
                    }
                )
            );

            // -----------------------------
            // Create PDF
            // -----------------------------

            const pdfDoc =
                await PDFDocument.create();

            // -----------------------------
            // Page sizes
            // -----------------------------

            const pageSizes = {

                A4: {
                    width: 595.28,
                    height: 841.89
                },

                A5: {
                    width: 419.53,
                    height: 595.28
                },

                Letter: {
                    width: 612,
                    height: 792
                },

                Legal: {
                    width: 612,
                    height: 1008
                }

            };

            // -----------------------------
            // User options
            // -----------------------------

            const pageSize =
                req.body.pageSize || "A4";

            const orientation =
                req.body.orientation ||
                "portrait";

            const marginValue =
                Number(req.body.margin);

            const margin =
                Number.isFinite(marginValue)
                    ? Math.max(0, marginValue)
                    : 20;

            // -----------------------------
            // Get page dimensions
            // -----------------------------

            let pageWidth =
                pageSizes[pageSize]?.width ||
                pageSizes.A4.width;

            let pageHeight =
                pageSizes[pageSize]?.height ||
                pageSizes.A4.height;

            // -----------------------------
            // Landscape
            // -----------------------------

            if (
                orientation === "landscape"
            ) {

                const temp =
                    pageWidth;

                pageWidth =
                    pageHeight;

                pageHeight =
                    temp;

            }

            // =================================
            // PROCESS EACH IMAGE
            // =================================

            for (const file of req.files) {

                const imageBytes =
                    fs.readFileSync(
                        file.path
                    );

                let image;

                // -----------------------------
                // PNG
                // -----------------------------

                if (
                    file.mimetype ===
                    "image/png"
                ) {

                    image =
                        await pdfDoc.embedPng(
                            imageBytes
                        );

                }

                // -----------------------------
                // JPG / JPEG
                // -----------------------------

                else {

                    image =
                        await pdfDoc.embedJpg(
                            imageBytes
                        );

                }

                // -----------------------------
                // Create page
                // -----------------------------

                const page =
                    pdfDoc.addPage([
                        pageWidth,
                        pageHeight
                    ]);

                // -----------------------------
                // Available area
                // -----------------------------

                const availableWidth =
                    Math.max(
                        1,
                        pageWidth -
                        margin * 2
                    );

                const availableHeight =
                    Math.max(
                        1,
                        pageHeight -
                        margin * 2
                    );

                // -----------------------------
                // Image ratio
                // -----------------------------

                const imageRatio =
                    image.width /
                    image.height;

                const pageRatio =
                    availableWidth /
                    availableHeight;

                let drawWidth;
                let drawHeight;

                // -----------------------------
                // Fit image
                // -----------------------------

                if (
                    imageRatio >
                    pageRatio
                ) {

                    drawWidth =
                        availableWidth;

                    drawHeight =
                        drawWidth /
                        imageRatio;

                } else {

                    drawHeight =
                        availableHeight;

                    drawWidth =
                        drawHeight *
                        imageRatio;

                }

                // -----------------------------
                // Center image
                // -----------------------------

                const x =
                    (pageWidth -
                        drawWidth) / 2;

                const y =
                    (pageHeight -
                        drawHeight) / 2;

                // -----------------------------
                // Draw image
                // -----------------------------

                page.drawImage(
                    image,
                    {

                        x: x,

                        y: y,

                        width: drawWidth,

                        height: drawHeight

                    }
                );

            }

            // =================================
            // SAVE PDF
            // =================================

            const pdfBytes =
                await pdfDoc.save();

            outputPath =
                path.join(
                    tempDir,
                    "PDF-Maker-" +
                    Date.now() +
                    ".pdf"
                );

            fs.writeFileSync(
                outputPath,
                pdfBytes
            );

            // =================================
            // DOWNLOAD PDF
            // =================================

            res.download(
                outputPath,
                "PDF-Maker-Images.pdf",

                function (error) {

                    cleanupFiles(
                        uploadedFiles
                    );

                    cleanupFile(
                        outputPath
                    );

                    if (error) {

                        console.error(
                            "Download error:",
                            error
                        );

                    }

                }
            );

        }

        catch (error) {

            console.error(
                "PDF creation error:",
                error
            );

            cleanupFiles(
                uploadedFiles
            );

            cleanupFile(
                outputPath
            );

            if (!res.headersSent) {

                res.status(500).json({

                    success: false,

                    message:
                        "Failed to create PDF.",

                    error:
                        error.message

                });

            }

        }

    }
);

// =====================================
// CLEANUP FUNCTIONS
// =====================================

function cleanupFile(filePath) {

    if (
        filePath &&
        fs.existsSync(filePath)
    ) {

        try {

            fs.unlinkSync(
                filePath
            );

        }

        catch (error) {

            console.error(
                "File cleanup error:",
                error
            );

        }

    }

}

function cleanupFiles(files) {

    for (
        const filePath of files
    ) {

        cleanupFile(
            filePath
        );

    }

}

// =====================================
// ERROR HANDLER
// =====================================

app.use(
    function (
        error,
        req,
        res,
        next
    ) {

        console.error(
            "Server error:",
            error
        );

        if (
            error.code ===
            "LIMIT_FILE_SIZE"
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "File is too large. Maximum size is 20 MB."

            });

        }

        if (
            error.code ===
            "LIMIT_FILE_COUNT"
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Maximum 20 images are allowed."

            });

        }

        res.status(400).json({

            success: false,

            message:
                error.message ||
                "Something went wrong."

        });

    }
);

// =====================================
// START SERVER
// =====================================

     // =====================================
app.get("/api/visit", function (req, res) {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const ua = req.headers["user-agent"] || "Unknown";

    let device = "Desktop";
    if (/tablet|ipad/i.test(ua)) device = "Tablet";
    else if (/mobile|android|iphone|ipod/i.test(ua)) device = "Mobile";

    let os = "Unknown";
    if (/android/i.test(ua)) os = "Android";
    else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
    else if (/windows/i.test(ua)) os = "Windows";
    else if (/mac os/i.test(ua)) os = "macOS";
    else if (/linux/i.test(ua)) os = "Linux";

    let browser = "Unknown";
    if (/edg\//i.test(ua)) browser = "Edge";
    else if (/chrome\//i.test(ua)) browser = "Chrome";
    else if (/firefox\//i.test(ua)) browser = "Firefox";
    else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";

    visitors.push({
        ip,
        device,
        os,
        browser,
        lastSeen: new Date().toISOString()
    });

    res.json({ success: true });
});

app.get("/api/admin/visitors", function (req, res) {
    const key = (req.headers["x-admin-key"] || req.query.key || "").trim();

    if (!key || key !== (process.env.ADMIN_KEY || "").trim()) {
        return res.status(403).json({
            success: false,
            message: "Access denied"
        });
    }

    const list = visitors.slice().sort(
        (a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)
    );

    res.json({
        success: true,
        totalVisitors: list.length,
        activeVisitors: list.filter(
            v => Date.now() - new Date(v.lastSeen).getTime() < 5 * 60 * 1000
        ).length,
        visitors: list
    });
});

app.get("/terms-policy", function (req, res) { res.sendFile(require("path").join(__dirname, "terms-policy.html")); });
app.get("/admin", function (req, res) { res.sendFile(path.join(__dirname, "admin.html")); });
app.listen(
    PORT,
    "0.0.0.0",

    function () {

        console.log("");
        console.log(
            "================================="
        );

        console.log(
            "       PDF MAKER BACKEND"
        );

        console.log(
            "================================="
        );

        console.log(
            "Server: http://127.0.0.1:" +
            PORT
        );

        console.log(
            "Images -> PDF API ready"
        );

        console.log(
            "================================="
        );

        console.log("");

    }
);



