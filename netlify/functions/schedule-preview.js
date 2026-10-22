const {privateViewHandler} = require('../lib/private-view.cjs');
const {schedulePreview} = require('../lib/schedule-preview.cjs');
exports.createHandler = (load = schedulePreview) => privateViewHandler(load, {image: true});
exports.handler = exports.createHandler();
