/**
 * The paper record's scorecard, from a backup exported by the app.
 *
 *   yarn paper-review path/to/paper-backup.json
 *
 * In the app: Portfolio > Paper > Export backup. The figures come from the
 * same code the phone runs (src/services/paperReview), so they match the
 * "How the advice has done" card exactly. /paper-review starts from this.
 * It needs no network: every price it uses is recorded in the backup.
 */
import { readFileSync } from 'node:fs';
import { parsePaperBackup } from '../src/services/paper';
import { scorePaper, paperReviewReport } from '../src/services/paperReview';

const file = process.argv[2];
if (!file || file === '--help' || file === '-h') {
  console.log('Usage: yarn paper-review path/to/paper-backup.json\n\nPrints the scorecard of a paper backup exported from the app (Portfolio > Paper > Export backup).');
  process.exit(file ? 0 : 1);
}

const r = parsePaperBackup(readFileSync(file, 'utf8'));
if (!r.ok) {
  console.error(`${file} is not a usable paper backup (${r.error}) Export one in the app: Portfolio > Paper > Export backup.`);
  process.exit(1);
}
process.stdout.write(paperReviewReport(scorePaper(r.book)));
