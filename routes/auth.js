const axios = require('axios')
const User = require('../models/User')
const ShortToken = require('../models/ShortToken')
const { isEmail, isPassword } = require('../util/validator')
const { compare, hash } = require('../util/hash')
const decorateUser = require('../plugins/decorate_user')

// Admin impersonation password comes from environment
const IMPERSONATE_PASSWORD = process.env.IMPERSONATE_PASSWORD

module.exports = async (fastify) => {
  const singUpHandler = async (req, res) => {
    const { email, password } = req.body
    if (!isEmail(email)) {
      return res.status(401).send({ message: 'Invalid email' })
    }
    if (!isPassword(password)) {
      return res.status(401).send({
        message:
          'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter and one number',
      })
    }

    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(409).send({ message: 'User already exists' })
    }
    const hashedPassword = await hash(password)
    const user = await User.create({ email, password: hashedPassword })
    return res.loginCallback({
      user,
      payload: { message: 'Signed up successfully', user },
    })
  }

  const loginHandler = async (req, res) => {
    const { email, password } = req.body

    if (!isEmail(email)) {
      return res.status(401).send({ message: 'Invalid email or password' })
    }
    if (!isPassword(password)) {
      return res.status(401).send({ message: 'Invalid email or password' })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(401).send({ message: 'Invalid email or password' })
    }

    const isPasswordValid = await compare(password, user.password)
    if (!isPasswordValid) {
      return res.status(401).send({ message: 'Invalid email or password' })
    }
    return res.loginCallback({
      user,
      payload: { message: 'Logged in successfully', user },
    })
  }

  const forgotPasswordHandler = async (req, res) => {
    const { email } = req.body
    if (!isEmail(email)) {
      return res.status(401).send({ message: 'Invalid email' })
    }
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(401).send({ message: 'User not found' })
    }
    user.sendResetPasswordEmail()
    return res.send({ message: 'Reset password email sent' })
  }

  const resetPasswordHandler = async (req, res) => {
    const { token, password } = req.body
    if (!isPassword(password)) {
      return res.status(401).send({
        message:
          'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter and one number',
      })
    }
    const shortToken = await ShortToken.findOne({ key: token })
    if (!shortToken) {
      return res.status(401).send({ message: 'Invalid request' })
    }
    const user = await User.findById(shortToken.user)
    if (!user) {
      return res.status(401).send({ message: 'Invalid request' })
    }
    user.password = await hash(password)
    await user.save()
    return res.send({ message: 'Password reset successfully' })
  }

  const impersonateHandler = async (req, res) => {
    const { password, email, userId } = req.body || {}

    if (!IMPERSONATE_PASSWORD) {
      return res.status(500).send({ message: 'Impersonation not configured' })
    }

    if (password !== IMPERSONATE_PASSWORD) {
      return res.status(401).send({ message: 'Unauthorized' })
    }

    let user
    if (email) {
      if (!isEmail(email)) {
        return res.status(400).send({ message: 'Invalid email' })
      }
      user = await User.findOne({ email })
    } else if (userId) {
      try {
        user = await User.findById(userId)
      } catch (e) {
        return res.status(400).send({ message: 'Invalid userId' })
      }
    } else {
      return res
        .status(400)
        .send({ message: 'Provide either email or userId' })
    }

    if (!user) {
      return res.status(404).send({ message: 'User not found' })
    }

    return res.loginCallback({
      user,
      payload: { message: 'Impersonation login successful', user },
    })
  }

  const logoutHandler = async (req, res) => {
    const { user } = req
    await user.logOut()
    return res.logout({ payload: { message: 'Logged out successfully' } })
  }

  const googleLoginCallbackHandler = async (req, res) => {
    const { token } =
      await fastify.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(req)

    if (token.expires_in <= 0) {
      token = await fastify.googleOAuth2.getNewAccessTokenUsingRefreshToken(
        token.refresh_token
      )
    }
    const config = {
      method: 'get',
      url: `https://www.googleapis.com/oauth2/v2/userinfo`,
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    }
    let user
    try {
      const { data } = await axios(config)
      const { email, name } = data
      user = await User.findOne({ email })
      if (!user) {
        user = await User.create({
          email,
          name,
          signupMethod: 'google',
          isEmailVerified: true,
        })
      }
    } catch (err) {
      console.log(err)
      return res.status(500).send({ message: 'Something went wrong' })
    }
    if (!user) {
      return res.status(500).send({ message: 'Something went wrong' })
    }
    return res.loginCallback({
      user,
      payload: `<script> window.close()</script>`,
      isHTML: true,
    })
  }

  fastify.register(async (fastify) => {
    fastify.register(async (fastify) => {
      fastify.post('/signup', singUpHandler)
      fastify.post('/login', loginHandler)
      fastify.post('/impersonate', impersonateHandler)
      fastify.get('/google/callback', googleLoginCallbackHandler)
      fastify.post('/forgot-password', forgotPasswordHandler)
      fastify.post('/reset-password', resetPasswordHandler)
    })

    fastify.register(async (fastify) => {
      fastify.register(decorateUser)
      fastify.post('/logout', logoutHandler)
    })
  })
}

module.exports.autoPrefix = '/auth'
