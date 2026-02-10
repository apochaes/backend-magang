const multer = require("multer");
const path = require("path");

// IMPORTANT: Use memory storage for direct MinIO upload
// No need to save to local disk anymore!
const storage = multer.memoryStorage();

// File filter for security
const fileFilter = (req, file, cb) => {
  // Only allow images
  const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed (JPEG, PNG, WEBP)"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // Max 5MB per file
    files: 4, // Max 4 files
    fields: 10, // Max 10 non-file fields
    fieldNameSize: 100, // Max 100 bytes field name
    fieldSize: 1024 * 1024, // Max 1MB field value
  },
});

// Error handling middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ message: "File terlalu besar, maksimal 5MB" });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ message: "Maksimal 4 file" });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ message: "Field name tidak valid" });
    }
    return res.status(400).json({ message: "Upload error: " + err.message });
  } else if (err) {
    // Other errors (e.g., from fileFilter)
    return res.status(400).json({ message: err.message });
  }
  next();
};

module.exports = { upload, handleMulterError };
