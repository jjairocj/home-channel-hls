/**
 * Home Channel HLS - Programación automática asistida.
 *
 * - constants   franjas horarias, cierre nocturno y umbrales
 * - sagas       grupos de temporadas y su estado (temporada en curso, restantes…)
 * - allocation  reparto: tiras diarias, bloques semanales temáticos y repeticiones
 * - proposal    arma una propuesta de grilla semanal (función pura)
 * - rules/RuleCompiler  reglas → grilla de emisión (día de transmisión → calendario)
 * - ScheduleService     reglas (altas/cambios/bajas), vista semanal, migración
 * - ProgrammingManager  preferencias por serie, grupos, propuestas y revisión horaria
 */

const constants = require('./constants');
const sagas = require('./sagas');
const { allocateGrid } = require('./allocation');
const { buildRuleProposal } = require('./proposal');
const ProgrammingManager = require('./ProgrammingManager');
const ScheduleService = require('./ScheduleService');

module.exports = {
  ...constants,
  detectSagas: sagas.detectSagas,
  suggestFranja: sagas.suggestFranja,
  isEpisodic: sagas.isEpisodic,
  sagaFrequency: sagas.sagaFrequency,
  sagaStatus: sagas.sagaStatus,
  allocateGrid,
  buildRuleProposal,
  ProgrammingManager,
  ScheduleService
};
