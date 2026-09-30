// Executa os casos nomeados no mesmo processo, inclusive em workers onde o
// runner isolado apresenta somente o nome de cada arquivo.
import '../cloud-run/financial-ai-service/financial-analysis.test.js';
import '../cloud-run/financial-ai-service/handler.test.js';
import '../cloud-run/financial-ai-service/openai-provider.test.js';
