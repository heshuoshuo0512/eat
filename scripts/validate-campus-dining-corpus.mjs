import { loadCampusDiningChallengeQueries, loadCampusDiningCorpus } from '../server/campusDiningKnowledgeBase.js';

try {
  const corpus = loadCampusDiningCorpus({ refresh: true });
  const challenges = loadCampusDiningChallengeQueries({ refresh: true });
  console.log(JSON.stringify({ ok: true, version: corpus.manifest.version, ...corpus.report, challengeQueryCount: challenges.length }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}
