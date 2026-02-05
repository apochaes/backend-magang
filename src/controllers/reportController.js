const { minioClient, BUCKET_NAME } = require('../services/minio');
const fs = require('fs');
const pool = require('../services/db');
const redisClient = require('../services/redis');

// POST /reports
exports.createReport = async (req, res) => {
  const client = await pool.connect();

  try {
    const { title, description, category, location } = req.body;

    if (!title || !description || !category) {
      return res.status(400).json({ message: 'Field tidak lengkap' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Minimal 1 foto diupload' });
    }

    await client.query('BEGIN');

    // insert report
    const reportResult = await client.query(
      `INSERT INTO reports (title, description, category, location)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [title, description, category, location || null]
    );

    const reportId = reportResult.rows[0].id;

    // insert foto
    for (const file of req.files) {
      const filePath = file.path;
      const objectName = `${Date.now()}-${file.originalname}`;

      await minioClient.fPutObject(
        BUCKET_NAME,
        objectName,
        filePath
      );

      await client.query(
        `INSERT INTO report_photos (report_id, photo_url)
        VALUES ($1, $2)`,
        [reportId, objectName]
      );

      // hapus file lokal setelah sukses upload
      fs.unlinkSync(filePath);
    }


    await client.query('COMMIT');

    // clear cache
    if (redisClient.isOpen) {
      await redisClient.flushAll();
    }

    return res.status(201).json({
      message: 'Report created',
      report_id: reportId,
      total_photos: req.files.length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: 'Gagal membuat laporan' });
  } finally {
    client.release();
  }
};


// GET /reports
exports.getReports = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const cacheKey = `reports:${page}:${limit}`;

    // 1️⃣ redis
    if (redisClient.isOpen) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({
          source: 'cache',
          ...JSON.parse(cached),
        });
      }
    }

    // db
    const countResult = await pool.query('SELECT COUNT(*) FROM reports');
    const totalData = parseInt(countResult.rows[0].count, 10);

    const result = await pool.query(
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
    );

    const responseData = {
      page,
      limit,
      totalData,
      totalPage: Math.ceil(totalData / limit),
      data: result.rows
    };

    // cache
    if (redisClient.isOpen) {
      await redisClient.setEx(cacheKey, 60, JSON.stringify(responseData));
    }

    return res.json({
      source: 'database',
      ...responseData
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Gagal mengambil laporan' });
  }
};
