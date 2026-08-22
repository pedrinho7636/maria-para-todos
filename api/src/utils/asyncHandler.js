// Encaminha rejeições de rotas async para o middleware de erro do Express,
// em vez de virar uma exceção não tratada que derruba o processo.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
