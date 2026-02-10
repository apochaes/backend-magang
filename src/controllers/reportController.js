const { minioClient, BUCKET_NAME } = require("../services/minio");
const pool = require("../services/db");
const { redisClient, safeRedisCommand } = require("../services/redis");
const { Readable } = require("stream");

// POST /reports
exports.createReport = async (req, res) => {
  let reportId = null;
  const uploadedFiles = [];

  try {
    const { title, description, category, location } = req.body;

    // Validation
    if (!title || !description || !category) {
      return res.status(400).json({ message: "Field tidak lengkap" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "Minimal 1 foto diupload" });
    }

    // Set a timeout for the entire operation
    const operationTimeout = setTimeout(() => {
      throw new Error("Operation timeout");
    }, 25000); // 25 seconds (sebelum nginx/app timeout)

    // STEP 1: Insert report FIRST and COMMIT immediately
    // This ensures report exists before we try to insert photos
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const reportResult = await client.query(
        `INSERT INTO reports (title, description, category, location)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [title, description, category, location || null],
      );

      reportId = reportResult.rows[0].id;

      // COMMIT report immediately so it exists for foreign key
      await client.query("COMMIT");
      console.log(`Report ${reportId} created and committed`);
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }

    // STEP 2: Upload photos to MinIO in PARALLEL
    const uploadPromises = req.files.map(async (file) => {
      const objectName = `${Date.now()}-${process.pid}-${Math.round(Math.random() * 1e9)}-${file.originalname}`;

      try {
        // Convert buffer to stream for MinIO
        const bufferStream = Readable.from(file.buffer);

        // Upload to MinIO
        await minioClient.putObject(
          BUCKET_NAME,
          objectName,
          bufferStream,
          file.size,
          {
            "Content-Type": file.mimetype,
            "X-Upload-Date": new Date().toISOString(),
          },
        );

        console.log(`Uploaded to MinIO: ${objectName}`);
        uploadedFiles.push(objectName);

        return { objectName, success: true };
      } catch (err) {
        console.error(
          `Failed to upload ${file.originalname} to MinIO:`,
          err.message,
        );
        return {
          objectName: file.originalname,
          success: false,
          error: err.message,
        };
      }
    });

    const uploadResults = await Promise.allSettled(uploadPromises);

    // Check if any uploads failed
    const failedUploads = uploadResults.filter(
      (r) => r.status === "rejected" || !r.value?.success,
    );
    if (failedUploads.length > 0) {
      console.error("Some uploads failed:", failedUploads);
      // Continue anyway - at least some photos might have succeeded
    }

    // STEP 3: Insert photo records to database
    // Now that report is committed, foreign key will work
    const photoInsertPromises = uploadedFiles.map(async (objectName) => {
      try {
        await pool.query(
          `INSERT INTO report_photos (report_id, photo_url)
          VALUES ($1, $2)`,
          [reportId, objectName],
        );
        console.log(`DB record created for: ${objectName}`);
        return { objectName, success: true };
      } catch (err) {
        console.error(
          `Failed to insert photo record for ${objectName}:`,
          err.message,
        );
        return { objectName, success: false, error: err.message };
      }
    });

    await Promise.allSettled(photoInsertPromises);

    clearTimeout(operationTimeout);

    // Invalidate cache - only specific keys
    await safeRedisCommand("del", "reports:1:10");

    return res.status(201).json({
      message: "Report created",
      report_id: reportId,
      total_photos: uploadedFiles.length,
      photos: uploadedFiles,
    });
  } catch (error) {
    console.error("Create report error:", error.message);

    // Cleanup: If we created a report but upload failed, delete the report
    if (reportId) {
      try {
        await pool.query("DELETE FROM reports WHERE id = $1", [reportId]);
        console.log(`Cleaned up report ${reportId} due to error`);
      } catch (cleanupErr) {
        console.error("Failed to cleanup report:", cleanupErr.message);
      }
    }

    // Cleanup: delete uploaded files from MinIO if transaction failed
    if (uploadedFiles.length > 0) {
      const cleanupPromises = uploadedFiles.map(async (objectName) => {
        try {
          await minioClient.removeObject(BUCKET_NAME, objectName);
          console.log(`Cleaned up MinIO: ${objectName}`);
        } catch (cleanupErr) {
          console.error(`Failed to cleanup ${objectName}:`, cleanupErr.message);
        }
      });
      await Promise.allSettled(cleanupPromises);
    }

    // Send appropriate error response
    if (error.message === "Operation timeout") {
      return res
        .status(504)
        .json({ message: "Request timeout - operation took too long" });
    }

    return res.status(500).json({
      message: "Gagal membuat laporan",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// GET /reports
exports.getReports = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Validate pagination params
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({ message: "Invalid pagination parameters" });
    }

    const cacheKey = `reports:${page}:${limit}`;

    // Try cache first with error handling
    const cached = await safeRedisCommand("get", cacheKey);
    if (cached) {
      return res.json({
        source: "cache",
        ...JSON.parse(cached),
      });
    }

    // Query database
    const [countResult, result] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM reports"),
      pool.query(
        `
        SELECT
          r.id,
          r.title,
          r.description,
          r.category,
          r.location,
          r.created_at,
          COALESCE(
            json_agg(p.photo_url) FILTER (WHERE p.id IS NOT NULL),
            '[]'
          ) AS photos
        FROM reports r
        LEFT JOIN report_photos p ON p.report_id = r.id
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset],
      ),
    ]);

    const totalData = parseInt(countResult.rows[0].count, 10);

    const responseData = {
      page,
      limit,
      totalData,
      totalPage: Math.ceil(totalData / limit),
      data: result.rows,
    };

    // Cache the result (don't block response if caching fails)
    safeRedisCommand("setEx", cacheKey, 60, JSON.stringify(responseData)).catch(
      (err) => console.warn("Cache write failed:", err.message),
    );

    return res.json({
      source: "database",
      ...responseData,
    });
  } catch (error) {
    console.error("Get reports error:", error.message);
    return res.status(500).json({
      message: "Gagal mengambil laporan",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
