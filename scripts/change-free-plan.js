const db = require('../db')
const User = require('../models/User')

const changeFreePlan = async () => {
  await User.updateMany({ currentPlan: 'free' }, { currentPlan: 'starter' })
}

const main = async () => {
  await db()
  await changeFreePlan()
  process.exit(0)
}

main()
