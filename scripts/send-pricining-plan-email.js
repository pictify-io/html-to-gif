const db = require('../db')
const User = require('../models/User')
const { sendEmail } = require('../service/sendgrid')
const EmailLog = require('../models/EmailLog')

const type = 'PRICING_PLAN_EMAIL'

const sendPricingPlanEmail = async () => {
  const users = await User.find().sort({ createdAt: -1 }).limit(40)

  for (const user of users) {
    console.log(`Sending pricing plan email to ${user.email}`)
    const isEmailSent = await EmailLog.findOne({
      user: user._id,
      type,
    })

    if (isEmailSent) {
      console.log('Pricing plan email already sent')
      continue
    }

    await sendEmail({
      to: user.email,
      subject: 'Pictify.io: We are out of Beta!',
      templatePath: 'templates/marketing/out-of-beta.ejs',
      from: {
        email: 'suyash@pictify.io',
        name: 'Suyash: Pictify.io',
      },
      data: {},
    })

    await EmailLog.create({
      user: user._id,
      type,
    })
  }
}

const main = async () => {
  console.log('Connecting to database')
  await db()
  console.log('Sending pricing plan emails')
  await sendPricingPlanEmail()
  process.exit(0)
}

main()
