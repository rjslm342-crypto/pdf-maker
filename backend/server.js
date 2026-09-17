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

        files: 45

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
                    "Only JPG, JPEG and PNG images are allowed."
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
    upload.array("images", 500),

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

            // =================================
            // UNIVERSAL IMAGE PROCESSING
            // =================================

            /*
              cross-image is pure JavaScript and does not
              require native libraries such as sharp.

              It decodes the uploaded file directly from
              its bytes instead of relying on the browser.
            */

            const {
                Image
            } = await import("cross-image");

            /*
              96 DPI is enough for normal PDF viewing and
              printing while keeping 400+ image PDFs
              considerably more memory efficient.
            */

            const DPI = 96;

            const pointsToPixels =
                DPI / 72;

            const maxImageWidth =
                Math.max(
                    1,
                    Math.round(
                        pageWidth * pointsToPixels
                    )
                );

            const maxImageHeight =
                Math.max(
                    1,
                    Math.round(
                        pageHeight * pointsToPixels
                    )
                );

            let processedFlags = [];

            try {
                if (req.body && req.body.processedFlags) {
                    processedFlags = JSON.parse(req.body.processedFlags);
                }
            } catch (error) {
                console.warn("Could not parse processedFlags:", error.message);
                processedFlags = [];
            }

            for (
                let imageIndex = 0;
                imageIndex < req.files.length;
                imageIndex++
            ) {

                const file =
                    req.files[imageIndex];

                console.log(
                    "Processing image " +
                    (imageIndex + 1) +
                    "/" +
                    req.files.length +
                    ": " +
                    file.originalname +
                    " (" +
                    file.mimetype +
                    ", " +
                    file.size +
                    " bytes)"
                );

                let image = null;
                let jpegBytes = null;

                try {

                    // -----------------------------
                    // Read original bytes
                    // -----------------------------

                    const imageStartTime = Date.now();

                    const imageBytes =
                        fs.readFileSync(
                            file.path
                        );

                    // -----------------------------
                    // JPEG FAST PATH
                    // -----------------------------

                    const browserProcessed =
                        processedFlags[imageIndex] === "1";

                    if (browserProcessed) {

                        console.log(
                            "Frontend JPEG ready: direct embed, skipping cross-image"
                        );

                        jpegBytes = imageBytes;

                    } else if (file.mimetype === "image/jpeg") {

                        console.log(
                            "JPEG fallback: decoding and re-encoding JPEG"
                        );

                        image = await Image.decode(
                            new Uint8Array(imageBytes),
                            {
                                tolerantDecoding:true,
                                runtimeDecoding:"prefer"
                            }
                        );

                        if (!image || !image.width || !image.height) {
                            throw new Error(
                                "JPEG decoder returned invalid dimensions"
                            );
                        }

                        jpegBytes = await image.encode(
                            "jpeg",
                            {
                                quality:82,
                                progressive:false
                            }
                        );

                        console.log(
                            "JPEG normalized:",
                            jpegBytes.length,
                            "bytes"
                        );

                    } else {

                        // -----------------------------
                        // Universal decode
                        // -----------------------------

                        image =
                            await Image.decode(
                                new Uint8Array(
                                    imageBytes
                                ),
                                {
                                    tolerantDecoding:true,
                                    runtimeDecoding:"prefer",
                                    onWarning:function(
                                        message,
                                        details
                                    ){
                                        console.warn(
                                            "Image warning:",
                                            file.originalname,
                                            message,
                                            details || ""
                                        );
                                    }
                                }
                            );

                        if (
                            !image ||
                            !image.width ||
                            !image.height
                        ) {

                            throw new Error(
                                "Image decoder returned invalid dimensions"
                            );

                        }

                        console.log(
                            "Decoded:",
                            image.width +
                            "x" +
                            image.height
                        );

                        console.log(
                            "Decode time:",
                            (Date.now() - imageStartTime) + " ms"
                        );

                        // -----------------------------
                        // Calculate memory-friendly size
                        // -----------------------------

                        const scale =
                            Math.min(
                                1,
                                maxImageWidth /
                                image.width,
                                maxImageHeight /
                                image.height
                            );

                        if (scale < 1) {

                            image.resize({
                                width:Math.max(
                                    1,
                                    Math.round(
                                        image.width *
                                        scale
                                    )
                                ),
                                height:Math.max(
                                    1,
                                    Math.round(
                                        image.height *
                                        scale
                                    )
                                ),
                                fit:"fit",
                                method:"bicubic"
                            });

                        }

                        // -----------------------------
                        // Convert non-JPEG image to JPEG
                        // -----------------------------

                        const encodeStartTime = Date.now();

                        jpegBytes =
                            await image.encode(
                                "jpeg",
                                {
                                    quality:82,
                                    progressive:false
                                }
                            );

                        console.log(
                            "JPEG encode time:",
                            (Date.now() - encodeStartTime) + " ms",
                            "output:",
                            jpegBytes ? jpegBytes.length : 0,
                            "bytes"
                        );

                    }

                    // -----------------------------
                    // Validate decoded image only for non-JPEG
                    // -----------------------------

                    if (file.mimetype !== "image/jpeg") {

                        if (
                            !image ||
                            !image.width ||
                            !image.height
                        ) {

                            throw new Error(
                                "Image decoder returned invalid dimensions"
                            );

                        }

                        console.log(
                            "Decoded:",
                            image.width +
                            "x" +
                            image.height
                        );

                        console.log(
                            "Decode time:",
                            (Date.now() - imageStartTime) + " ms"
                        );

                    }


                    // -----------------------------
                    // Embed normalized JPEG
                    // -----------------------------

                    const pdfImage =
                        await pdfDoc.embedJpg(
                            jpegBytes
                        );

                    // -----------------------------
                    // Create PDF page
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
                        pdfImage.width /
                        pdfImage.height;

                    const pageRatio =
                        availableWidth /
                        availableHeight;

                    let drawWidth;
                    let drawHeight;

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
                        (
                            pageWidth -
                            drawWidth
                        ) / 2;

                    const y =
                        (
                            pageHeight -
                            drawHeight
                        ) / 2;

                    // -----------------------------
                    // Draw image
                    // -----------------------------

                    page.drawImage(
                        pdfImage,
                        {
                            x:x,
                            y:y,
                            width:drawWidth,
                            height:drawHeight
                        }
                    );

                    console.log(
                        "Image " +
                        (imageIndex + 1) +
                        " processed successfully."
                    );

                } catch (imageError) {

                    console.error(
                        "Image processing failed:",
                        file.originalname,
                        imageError
                    );

                    throw new Error(
                        "Image " +
                        (imageIndex + 1) +
                        " (" +
                        file.originalname +
                        ") could not be processed. " +
                        (
                            imageError &&
                            imageError.message
                                ? imageError.message
                                : String(imageError)
                        )
                    );

                } finally {

                    /*
                      Release references before processing
                      the next image.
                    */

                    image = null;
                    jpegBytes = null;

                    try {
                        if (
                            global.gc &&
                            imageIndex % 10 === 0
                        ) {
                            global.gc();
                        }
                    } catch (error) {}

                }

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
                    "Maximum 45 images are allowed."

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

// =====================================
// HERO IMAGE MANAGEMENT
// =====================================
const HERO_REPO = "rjslm342-crypto/pdf-maker";
const HERO_PATH = "frontend/hero-background.png";
let heroImageCache = null;
let heroImageContentType = "image/png";

function adminKeyIsValid(req) {
  const key = (req.headers["x-admin-key"] || req.query.key || "").trim();
  return !!key && key === (process.env.ADMIN_KEY || "").trim();
}

async function githubRequest(url, options = {}) {
  const token = (process.env.GITHUB_TOKEN || "").trim();
  if (!token) throw new Error("GitHub token is not configured.");

  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error("GitHub API " + response.status + ": " + text.slice(0, 300));
  }

  return response;
}

app.get("/api/hero-image", async function (req, res) {
  try {
    if (!heroImageCache) {
      const response = await githubRequest(
        "https://api.github.com/repos/" + HERO_REPO +
        "/contents/" + HERO_PATH + "?ref=master"
      );

      const data = await response.json();
      heroImageCache = Buffer.from(data.content.replace(/\s/g, ""), "base64");
      heroImageContentType =
        data.name && /\.jpe?g$/i.test(data.name) ? "image/jpeg" : "image/png";
    }

    res.set("Cache-Control", "public, max-age=300");
    res.type(heroImageContentType).send(heroImageCache);
  } catch (error) {
    console.error("Hero image fetch error:", error.message);
    res.status(500).json({
      success: false,
      message: "Hero image unavailable."
    });
  }
});

app.post("/api/admin/hero-image", upload.single("heroImage"), async function (req, res) {
  if (!adminKeyIsValid(req)) {
    return res.status(403).json({
      success: false,
      message: "Access denied"
    });
  }

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please select a JPG, JPEG or PNG image."
    });
  }

  try {
    const uploadedBuffer = fs.readFileSync(req.file.path);

    // Normalize JPG/JPEG/PNG to PNG so the existing
    // frontend hero-background.png path always remains valid.
    const { Image } = await import("cross-image");
    const image = await Image.decode(uploadedBuffer);

    if (!image || !image.width || !image.height) {
      throw new Error("Invalid hero image dimensions.");
    }

    const fileBuffer = await image.encode("png", {
      compressionLevel: 6
    });

    const getResponse = await githubRequest(
      "https://api.github.com/repos/" + HERO_REPO +
      "/contents/" + HERO_PATH + "?ref=master"
    );

    const currentFile = await getResponse.json();

    const putResponse = await githubRequest(
      "https://api.github.com/repos/" + HERO_REPO +
      "/contents/" + HERO_PATH,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "Update hero background image",
          content: Buffer.from(fileBuffer).toString("base64"),
          sha: currentFile.sha,
          branch: "master"
        })
      }
    );

    await putResponse.json();

    heroImageCache = fileBuffer;
    heroImageContentType = "image/png";

    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {}

    res.json({
      success: true,
      message: "Hero image updated successfully. Frontend will redeploy automatically."
    });
  } catch (error) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {}

    console.error("Hero image update error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not update hero image."
    });
  }
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





// PDF_MAKER_KEEP_ALIVE
setInterval(function () {}, 1000);
