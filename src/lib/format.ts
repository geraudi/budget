export const money = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

export const ratio = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 2,
})

export const percent = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
})
