const {privateViewHandler} = require('../lib/private-view.cjs');
const {ranking} = require('../lib/ranking.cjs');
exports.createHandler = (load = ranking) => privateViewHandler(load, {memberOnly: true});
exports.handler = exports.createHandler();
