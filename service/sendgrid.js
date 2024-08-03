const sgMail = require('@sendgrid/mail')
const ejs = require('ejs')

sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const getHTML = async ({ data, templatePath }) => {
  const emailLayout = 'templates/email-layout.ejs'
  const emailContent = await ejs.renderFile(templatePath, data)
  const emailHTML = await ejs.renderFile(emailLayout, { body: emailContent })
  return emailHTML
}

const sendEmail = async ({ to, subject, templatePath, data, from }) => {
  const html = await getHTML({ data, templatePath })
  const msg = {
    to,
    from: from || 'support@pictify.io',
    subject,
    html,
  }
  try {
    await sgMail.send(msg)
  } catch (error) {
    console.error(error)
  }
}

module.exports = {
  sendEmail,
  getHTML,
}
