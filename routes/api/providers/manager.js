module.exports = function(planner) {
    /****************************** GCIR - PORTAL CALIDAD ********************************************/
    //Para la Carga de Archivos:
    planner.use('/gcir/api/providers/date-files', require('../../../controllers/gcir/providers/date_files'));
    planner.use('/gcir/api/providers/sac-files', require('../../../controllers/gcir/providers/sac_files'));

    //Para las vistas de Proveedores:
    planner.use('/gcir/api/providers/directory', require('../../../controllers/gcir/providers/directory'));
    planner.use('/gcir/api/providers/contracts', require('../../../controllers/gcir/providers/contracts'));
    planner.use('/gcir/api/providers/homologation', require('../../../controllers/gcir/providers/homologation'));
    planner.use('/gcir/api/providers/distribution', require('../../../controllers/gcir/providers/distribution'));
    planner.use('/gcir/api/providers/performance', require('../../../controllers/gcir/providers/performance'));
    planner.use('/gcir/api/providers/performance-report', require('../../../controllers/gcir/providers/performance_report'));
    planner.use('/gcir/api/providers/affectations', require('../../../controllers/gcir/providers/affectations'));
    planner.use('/gcir/api/providers/facturation', require('../../../controllers/gcir/providers/facturation'));
    planner.use('/gcir/api/providers/sst', require('../../../controllers/gcir/providers/sst'));
    planner.use('/gcir/api/providers/sac', require('../../../controllers/gcir/providers/sac_files'));
    planner.use('/gcir/api/providers/snc', require('../../../controllers/gcir/providers/snc'));
    planner.use('/gcir/api/providers/library', require('../../../controllers/gcir/providers/library'));
    planner.use('/gcir/api/providers/history', require('../../../controllers/gcir/providers/history'));
    planner.use('/gcir/api/providers/settings', require('../../../controllers/gcir/providers/settings'));
    //planner.use('/gcir/api/providers/utils2', require('../../../controllers/gcir/providers/utils2'));

    //planner.use('/gcir/api/providers/snc_record', require('../../../controllers/gcir/providers/snc_record'));
    planner.use('/gcir/api/providers/no_compliance_contract', require('../../../controllers/gcir/providers/no_compliance_contract'));

    //Api para el envío de saludos de cumpleaños y para la generación de SNC:
    planner.use('/gcir/api/gerency_workers', require('../../../controllers/gcir/gerency_workers'));

    //TEMP: API budget
    planner.use('/gcir/api/providers/budget', require('../../../controllers/gcir/providers/budget'));
    planner.use('/gcir/api/providers/forecast', require('../../../controllers/gcir/providers/forecast'));
    planner.use('/gcir/api/providers/requirements', require('../../../controllers/gcir/providers/requirements'));

    // API PROJECTS
    planner.use('/gcir/api/projects/workflows', require('../../../controllers/gcir/projects/workflow.controller'));
    planner.use('/gcir/api/projects/tasks', require('../../../controllers/gcir/projects/task.controller'));
    planner.use('/gcir/api/projects/instances', require('../../../controllers/gcir/projects/instance.controller'));
    planner.use('/gcir/api/projects/comments', require('../../../controllers/gcir/projects/comment.controller'));
    planner.use('/gcir/api/projects/batches', require('../../../controllers/gcir/projects/batch.controller'));
    planner.use('/gcir/api/projects/site', require('../../../controllers/gcir/projects/site.controller'));
    planner.use('/gcir/api/projects/inbox', require('../../../controllers/gcir/projects/inbox.controller'));
    planner.use('/gcir/api/projects/tracking', require('../../../controllers/gcir/projects/tracking.controller'));
    planner.use('/gcir/api/projects/bulk', require('../../../controllers/gcir/projects/bulk.controller'));
    planner.use('/gcir/api/projects/forecast', require('../../../controllers/gcir/projects/forecast.controller'));
    planner.use('/gcir/api/projects/events', require('../../../controllers/gcir/projects/event.controller'));

};

