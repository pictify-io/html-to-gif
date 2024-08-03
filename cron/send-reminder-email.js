const db = require('../db')
const User = require('../models/User')
const { sendEmail } = require('../service/sendgrid')
const EmailLog = require('../models/EmailLog')

const type = 'DORMANT_USER_REMINDER_1'
const DATE_BEFORE = 1000 * 60 * 60 * 24 * 7 // 7 days
const sendReminderEmail = async () => {
  const users = await User.find({
    createdAt: { $lt: Date.now() - DATE_BEFORE },
    'usage.count': 0,
  })

  for (const user of users) {
    console.log(
      `Sending reminder email to ${user.email}, ${user.usage.count} images uploaded`
    )
    const isEmailSent = await EmailLog.findOne({
      user: user._id,
      type,
    })

    if (isEmailSent) {
      console.log('Reminder email already sent')
      continue
    }

    await sendEmail({
      to: user.email,
      subject: 'Pictify.io: Need some help?',
      templatePath: 'templates/user/dormant-user-reminder.ejs',
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
  console.log('Sending reminder emails')
  await sendReminderEmail()
  process.exit(0)
}

main()
