const mongoose = require('mongoose')
const uid = require('../util/uid')
const cheerio = require('cheerio');

const templateSchema = new mongoose.Schema({
  uid: {
    type: String,
    unique: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  name: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['og-image', 'custom'],
  },
  html: {
    type: String,
    required: true,
  },
  variables: {
    type: Array,
    required: true,
  },
  grapeJSData: {
    type: Object,
    required: false,
  },
  width: {
    type: Number,
    required: false,
  },
  height: {
    type: Number,
    required: false,
  },
  createdBy: {
    type: String,
    ref: 'User',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

//before saving the template, create uid
templateSchema.pre('save', async function (next) {
  const template = this
  if (!template.uid) {
    template.uid = await uid()
  }
  next()
})

templateSchema.methods.populateTemplate = async function (variables) {
  let html = this.html
  const variableKeys = this.variables
  variableKeys.forEach((key) => {
    const value = variables[key]
    html = html.replaceAll(`{{${key}}}`, value)
  })
  return html
}

templateSchema.methods.populateOgImage = async function (variables) {
  if (this.type !== 'og-image') {
    throw new Error('Template is not an og-image')
  }
  let html = this.html;
  const $ = cheerio.load(html);

  const validVariables = ['heading', 'description', 'logo'];
  validVariables.forEach((key) => {
    const value = variables[key];
    if (!value) {
      return;
    }

    switch (key) {
      case 'heading':
        $('#template-heading').text(value);
        break;
      case 'description':
        $('#template-subheading').text(value);
        break;
      case 'logo':
        $('#template-logo').attr('src', value);
        break;
    }
  });

  return $.html();
}

const filterActive = function (next) {
  this.where({ active: true })
  next()
}

templateSchema.pre('findOne', filterActive)
templateSchema.pre('find', filterActive)
templateSchema.pre('findById', filterActive)
templateSchema.pre('findByIdAndUpdate', filterActive)
templateSchema.pre('findByIdAndRemove', filterActive)
templateSchema.pre('findOneAndUpdate', filterActive)

const Template = mongoose.model('Template', templateSchema)

module.exports = Template
