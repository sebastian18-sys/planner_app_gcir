const setupDatabase = require('./db')

module.exports = async function() {
    const conn = await setupDatabase()

    //access
    const externalUserModel = require('../models/access/externalUserModel')(conn)
    const userModel = require('../models/access/userModel')(conn)

    //gcir
    const gcirEnterprise = require('../models/gcir/enterprise')(conn)
    const gcirGrency_workers = require('../models/gcir/gerency_workers')(conn)
    const gcirGrency_workers_copy = require('../models/gcir/gerency_workers_copy')(conn)
    //access
    const accessAreaModel = require('../models/gcir/access/areaModel')(conn)
    const accessGcirExternalUserModel = require('../models/gcir/access/externalUserModel')(conn)
    const accessProvModel = require('../models/gcir/access/provModel')(conn)
    const accessUserModel = require('../models/gcir/access/userModel')(conn)

    //economy
    const economyGeneral = require('../models/gcir/economy/general')(conn)
    const economyGeneral_solpe = require('../models/gcir/economy/general_solpe')(conn)

    //infrastructure
    const infrastEnterprise = require('../models/gcir/infrastructure/enterprise')(conn)

    //providers
    const provAffectations = require('../models/gcir/providers/affectations')(conn)
    const provAreas = require('../models/gcir/providers/areas')(conn)
    const provContracts = require('../models/gcir/providers/contracts')(conn)
    const provDate_files = require('../models/gcir/providers/date_files')(conn)
    const provDirectory = require('../models/gcir/providers/directory')(conn)
    const provDistribution = require('../models/gcir/providers/distribution')(conn)
    const provLibrary = require('../models/gcir/providers/library')(conn)
    const provHistory = require('../models/gcir/providers/history')(conn)
    const provSettings = require('../models/gcir/providers/settings')(conn)
    // const provExcel_emeplo = require('../models/gcir/providers/excel_emeplo')(conn)
    const provFacturation = require('../models/gcir/providers/facturation')(conn)
    const provHomologation = require('../models/gcir/providers/homologation')(conn)
    const provNo_Compliance_Contract = require('../models/gcir/providers/no_compliance_contract')(conn)
    const provPerfil = require('../models/gcir/providers/perfil')(conn)
    const provPerformance = require('../models/gcir/providers/performance')(conn)
    const provPerformance_report = require('../models/gcir/providers/performance_report')(conn)
    const provProfiles = require('../models/gcir/providers/profiles')(conn)
    const provProviders = require('../models/gcir/providers/providers')(conn)
    const provSac_files = require('../models/gcir/providers/sac_files')(conn)
    const provSnc = require('../models/gcir/providers/snc')(conn)
    const provSst = require('../models/gcir/providers/sst')(conn)

    //models
    const usuarioExtenoModel = require('../models/usuarioExternoModel')(conn)
    const usuarioModel = require('../models/usuarioModel')(conn)

    //budget
    const provProjects = require('../models/gcir/budget/projects')(conn)
    const provRQ_agrupado = require('../models/gcir/budget/rq_agrupado')(conn)
    const provCR_individual = require('../models/gcir/budget/cr_individual')(conn)
    const provInvestment_lines = require('../models/gcir/budget/investment_lines')(conn)
    const provLine_monthly_ledger = require('../models/gcir/budget/line_monthly_ledger')(conn)
    const provTickets = require('../models/gcir/budget/tickets')(conn)
    const provSites = require('../models/gcir/budget/sites')(conn)
    const provPayments = require('../models/gcir/budget/payments')(conn)
    const provPaymentsSites = require('../models/gcir/budget/payments_sites')(conn)
    const provSettlements = require('../models/gcir/budget/settlement')(conn)
    const provSettlementsSites = require('../models/gcir/budget/settlement_sites')(conn)
    const provDeliverables = require('../models/gcir/budget/deliverables')(conn)
    const provDeliverablesTemplateTypes = require('../models/gcir/budget/deliverables_template_types')(conn)
    const provDeliverablesTypesFields = require('../models/gcir/budget/deliverables_types_fields')(conn)
    const provValidations = require('../models/gcir/budget/validations')(conn)
    const provCounters = require('../models/gcir/budget/counters')(conn)
    const provOpex = require('../models/gcir/budget/opex')(conn)
    const provOpexEstimacion = require('../models/gcir/budget/opex_estimacion')(conn)
    const provForecast = require('../models/gcir/budget/forecast')(conn)

    // Projects
    const provWfSites = require('../models/gcir/projects/wf_sites')(conn)
    const provWfWorkflows = require('../models/gcir/projects/wf_workflows')(conn)
    const provWfVersions = require('../models/gcir/projects/wf_versions')(conn)
    const provWfTasks = require('../models/gcir/projects/wf_tasks')(conn)
    const provWfInstances = require('../models/gcir/projects/wf_instances')(conn)
    const provWfEvents = require('../models/gcir/projects/wf_events')(conn)
    const provWfBatchs = require('../models/gcir/projects/wf_batchs')(conn)
    const provWfWorkItems = require('../models/gcir/projects/wf_work_items')(conn)
    const provWfComments = require('../models/gcir/projects/wf_comments')(conn)
    const provWfIdentifiersCounter = require('../models/gcir/projects/wf_identifiers_counter')(conn)

    return {
       //access
       externalUserModel,
       userModel,

       //gcir
       gcirEnterprise,
       gcirGrency_workers,
       gcirGrency_workers_copy,
       //access
       accessAreaModel,
       accessGcirExternalUserModel,
       accessProvModel,
       accessUserModel,

       //economy
       economyGeneral,
       economyGeneral_solpe,

       //infrastructure
       infrastEnterprise,

       //providers
       provAffectations,
       provAreas,
       provContracts,
       provDate_files,
       provDirectory,
       provDistribution,
       provLibrary,
       provHistory,
       provSettings,
       // provExcel_emeplo,
       provHomologation,
       provFacturation,
       provNo_Compliance_Contract,
       provPerfil,
       provPerformance,
       provPerformance_report,
       provProfiles,
       provProviders,
       provSac_files,
       provSnc,
       provSst,

       //models
       usuarioExtenoModel,
       usuarioModel,

       //budget
       provProjects,
       provRQ_agrupado,
       provCR_individual,
       provInvestment_lines,
       provLine_monthly_ledger,
       provTickets,
       provSites,
       provPayments,
       provPaymentsSites,
       provSettlements,
       provSettlementsSites,
       provDeliverables,
       provDeliverablesTemplateTypes,
       provDeliverablesTypesFields,
       provValidations,
       provCounters,
       provOpex,
       provOpexEstimacion,
       provForecast,

       //projects
       provWfSites,
       provWfWorkflows,
       provWfVersions,
       provWfTasks,
       provWfInstances,
       provWfEvents,
       provWfBatchs,
       provWfWorkItems,
       provWfComments,
       provWfIdentifiersCounter
    }

}
