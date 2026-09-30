module.exports = function(planner) {
    /****************************** GCIR - PORTAL INFRAESTRUCTURA ********************************************/
    planner.use('/gcir/api/access', require('../../../controllers/gcir/access/manager'));
    planner.use('/gcir/api/infrastructure/enterprise', require('../../../controllers/gcir/infrastructure/enterprise'));
    planner.use('/gcir/api/infrastructure/converter', require('../../../controllers/gcir/infrastructure/manager'));
};

