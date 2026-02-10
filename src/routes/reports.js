const express = require("express");
const router = express.Router();
const { upload, handleMulterError } = require("../middlewares/upload");
const controller = require("../controllers/reportController");

// POST /reports with error handling
router.post(
  "/",
  upload.array("photos", 4),
  handleMulterError,
  controller.createReport,
);

// GET /reports
router.get("/", controller.getReports);

module.exports = router;
