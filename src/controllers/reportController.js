const { minioClient, BUCKET_NAME } = require("../services/minio");
const pool = require("../services/db");
const { safeRedisCommand } = require("../services/redis");
const { Readable } = require("stream");

/* =====================================================
   CREATE REPORT
===================================================== */
exports.createReport = async (req, res) => {
  let reportId = null;
  const uploadedFiles = [];

  const mainOperation = async () => {
    const { title, description, category, location } = req.body;

    // ===== VALIDATION =====
    if (!title || !description || !category) {
      throw { status: 400, message: "Field tidak lengkap" };
    }

    if (!req.files || req.files.length === 0) {
      throw { status: 400, message: "Minimal 1 foto diupload" };
    }

    /* =============================
       STEP 1 - INSERT REPORT
    ============================== */
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO reports (title, description, category, location)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [title, description, category, location || null]
      );

      reportId = result.rows[0].id;

      await client.query("COMMIT");
      console.log(`Report ${reportId} created`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    /* =============================
       STEP 2 - UPLOAD TO MINIO
    ============================== */
    const uploadPromises = req.files.map(async (file) => {
      const objectName = `${Date.now()}-${process.pid}-${Math.round(
        Math.random() * 1e9
      )}-${file.originalname}`;

      const stream = Readable.from(file.buffer);

      await minioClient.putObject(
        BUCKET_NAME,
        objectName,
        stream,
        file.size,
        {
          "Content-Type": file.mimetype,
        }
      );

      uploadedFiles.push(objectName);
      console.log(`Uploaded: ${objectName}`);
      return objectName;
    });

    await Promise.all(uploadPromises);

    /* =============================
       STEP 3 - INSERT PHOTO RECORD
    ============================== */
    const insertPhotoPromises = uploadedFiles.map((objectName) =>
      pool.query(
        `INSERT INTO report_photos (report_id, photo_url)
         VALUES ($1, $2)`,
        [reportId, objectName]
      )
    );

    await Promise.all(insertPhotoPromises);

    /* =============================
       STEP 4 - INVALIDATE CACHE
    ============================== */
    await safeRedisCommand("del", "reports:1:10").catch(() => {});

    return {
      status: 201,
      data: {
        message: "Report created",
        report_id: reportId,
        total_photos: uploadedFiles.length,
        photos: uploadedFiles,
      },
    };
  };

  try {
    // 25s global timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Operation timeout")), 25000)
    );

    const result = await Promise.race([
      mainOperation(),
      timeoutPromise,
    ]);

    return res.status(result.status).json(result.data);
  } catch (error) {
    console.error("Create report error:", error.message);

    // ===== CLEANUP DATABASE =====
    if (reportId) {
      await pool
        .query("DELETE FROM reports WHERE id = $1", [reportId])
        .catch(() => {});
    }

    // ===== CLEANUP MINIO =====
    if (uploadedFiles.length > 0) {
      await Promise.allSettled(
        uploadedFiles.map((obj) =>
          minioClient.removeObject(BUCKET_NAME, obj)
        )
      );
    }

    if (error.message === "Operation timeout") {
      return res.status(504).json({
        message: "Request timeout - operation took too long",
      });
    }

    return res.status(error.status || 500).json({
      message: error.message || "Gagal membuat laporan",
    });
  }
};

/* =====================================================
   GET REPORTS
===================================================== */
exports.getReports = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    if (page < 1 || limit < 1 || limit > 100) {
      return res
        .status(400)
        .json({ message: "Invalid pagination parameters" });
    }

    const offset = (page - 1) * limit;
    const cacheKey = `reports:${page}:${limit}`;

    /* =============================
       CHECK REDIS CACHE
    ============================== */
    const cached = await safeRedisCommand("get", cacheKey);
    if (cached) {
      return res.json({
        source: "cache",
        ...JSON.parse(cached),
      });
    }

    /* =============================
       QUERY DATABASE
    ============================== */
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
        [limit, offset]
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

    /* =============================
       SAVE TO REDIS (NON BLOCKING)
    ============================== */
    safeRedisCommand(
      "setEx",
      cacheKey,
      60,
      JSON.stringify(responseData)
    ).catch(() => {});

    return res.json({
      source: "database",
      ...responseData,
    });
  } catch (error) {
    console.error("Get reports error:", error.message);

    return res.status(500).json({
      message: "Gagal mengambil laporan",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

