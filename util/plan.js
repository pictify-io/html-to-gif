const slugRequestPerMonthMap = {
  'starter': 50,
  'basic': 1500,
  'standard': 3500,
  'professional': 7500,
  'advanced': 12000,
  'pro-plus': 20000,
  'business': 40000,
  'business-plus': 60000,
  'premium': 80000,
  'premium-plus': 120000,
  'enterprise': 150000,
  'enterprise-plus': 250000,
  'elite': 400000,
  'elite-plus': 600000,
  'ultimate': 1000000,
}


const convertPlanToSlug = (plan) => {
  return plan.toLowerCase().replace(' ', '-');
};

const getRequestLimit = (plan) => {
  return slugRequestPerMonthMap[plan];
}

module.exports = {
  convertPlanToSlug,
  getRequestLimit
}