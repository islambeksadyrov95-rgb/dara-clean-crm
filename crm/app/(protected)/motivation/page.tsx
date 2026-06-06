import { getManagerPerformance } from './actions'
import { MotivationClient } from './motivation-client'

export const dynamic = 'force-dynamic'

export default async function MotivationPage() {
  const data = await getManagerPerformance()

  return <MotivationClient initialData={data} />
}
