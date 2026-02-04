const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const controller = require('../controllers/reportController');

router.post('/', upload.array('photos', 4), controller.createReport);
router.get('/', controller.getReports);

module.exports = router;
