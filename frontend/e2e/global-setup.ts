import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Момент начала прогона: teardown откатывает только сделки, созданные после него. */
export default function globalSetup() {
  writeFileSync(join(import.meta.dirname, '.run-started'), new Date().toISOString())
}
