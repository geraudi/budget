/**
 * Retrieval evaluation set: 50 questions phrased the way a user would ask them,
 * never reusing the card title. It mixes ordinary paraphrases, short variants,
 * light typos, missing accents and two-concept questions that must separate
 * neighbouring cards. It is the regression guard for any change to the corpus,
 * the tokenizer or the scoring — not a set tuned to reach 100 %.
 */
export type KnowledgeEvalCase = {
  query: string
  expected: string
}

export const KNOWLEDGE_EVAL_SET: KnowledgeEvalCase[] = [
  { query: 'Comment répartir mon budget entre besoins, envies et épargne ?', expected: 'budget_50_30_20' },
  { query: "Combien d'argent garder de côté pour les imprévus ?", expected: 'epargne_precaution_montant' },
  { query: 'Que faire quand le solde est négatif chaque mois ?', expected: 'education_decouvert_frais' },
  { query: 'Comment repérer les abonnements que je peux supprimer ?', expected: 'depenses_abonnements_audit' },
  { query: 'Est-ce intéressant de solder mon prêt immobilier avant la fin ?', expected: 'dette_remboursement_anticipe' },
  { query: 'Que signifie le TAEG sur une offre de prêt ?', expected: 'dette_cout_total_credit' },
  { query: "Je n'arrive plus à payer mes dettes, qui peut m'aider ?", expected: 'difficulte_orientation' },
  { query: 'Comment monter un dossier auprès de la Banque de France ?', expected: 'difficulte_surendettement' },
  { query: 'Combien mettre de côté par mois pour financer un projet ?', expected: 'objectif_effort_mensuel' },
  { query: 'Par quel objectif commencer quand on en a plusieurs ?', expected: 'objectif_priorisation' },
  { query: "Qu'est-ce que le reste à vivre d'un foyer ?", expected: 'budget_reste_a_vivre' },
  { query: 'Quelle différence entre une charge fixe et une dépense variable ?', expected: 'budget_fixe_variable' },
  { query: 'Comment préparer un budget pour le mois à venir ?', expected: 'budget_previsionnel_mensuel' },
  { query: "Comment éviter d'acheter sur un coup de tête ?", expected: 'depenses_achats_impulsifs' },
  { query: 'Faut-il changer de fournisseur pour payer moins cher ?', expected: 'depenses_negociation_contrats' },
  { query: 'Quel est le plafond du Livret A ?', expected: 'epargne_livret_a_ldds' },
  { query: 'Vaut-il mieux virer une somme fixe chaque mois sur un livret ?', expected: 'epargne_automatisation' },
  { query: 'Comment les intérêts produisent-ils des intérêts ?', expected: 'education_interets_composes' },
  { query: "L'inflation réduit-elle la valeur de mon épargne ?", expected: 'education_inflation' },
  { query: 'Que faire avant de rater un prélèvement automatique ?', expected: 'dette_prevention_impayes' },

  // Paraphrases with ordinary, non-expert vocabulary.
  { query: 'Comment couper mon salaire en trois parts : essentiel, plaisir et economie ?', expected: 'budget_50_30_20' },
  { query: 'Combien de mois de depenses dois-je garder en cas de coup dur ?', expected: 'epargne_precaution_montant' },
  { query: 'Ma banque me facture des agios, comment limiter la note ?', expected: 'education_decouvert_frais' },
  { query: 'Comment calculer le cout annuel de mes abonnements pour voir ce qui sert vraiment ?', expected: 'depenses_abonnements_audit' },
  { query: "Quelle indemnite si je rembourse mon credit avant la fin ?", expected: 'dette_remboursement_anticipe' },
  { query: 'Le taux affiche sur mon pret suffit-il pour comparer deux banques ?', expected: 'dette_cout_total_credit' },
  { query: "Ou trouver un conseiller gratuit quand je ne m en sors plus avec mon argent ?", expected: 'difficulte_orientation' },
  { query: 'Quels documents faut-il pour deposer un dossier de surendettement ?', expected: 'difficulte_surendettement' },
  { query: 'Si je veux mettre 4000 euros de cote en 10 mois, combien par mois ?', expected: 'objectif_effort_mensuel' },
  { query: 'Comment calculer ce qui me reste vraiment pour vivre chaque mois ?', expected: 'budget_reste_a_vivre' },
  { query: 'Comment prevoir les grosses depenses de l annee dans mon budget mensuel ?', expected: 'budget_previsionnel_mensuel' },
  { query: "J achete souvent sans reflechir en ligne, comment casser cette habitude ?", expected: 'depenses_achats_impulsifs' },
  { query: "Mon assurance auto augmente chaque annee, comment obtenir un meilleur tarif ?", expected: 'depenses_negociation_contrats' },
  { query: 'Quel est le montant maximum que je peux mettre sur un LDDS ?', expected: 'epargne_livret_a_ldds' },
  { query: 'Un virement automatique juste apres la paie, bonne idee ?', expected: 'epargne_automatisation' },
  { query: "Un versement mensuel est-il mieux qu un versement unique pour faire travailler les interets ?", expected: 'education_interets_composes' },
  { query: 'Comment comparer le rendement de mon epargne a la hausse des prix ?', expected: 'education_inflation' },
  { query: 'Comment eviter les frais quand un prelevement va etre refuse ?', expected: 'dette_prevention_impayes' },

  // Short variants, light typos, missing accents.
  { query: 'La regle 50 30 20 est-elle obligatoire ?', expected: 'budget_50_30_20' },
  { query: 'C est quoi un decouvert autorise ?', expected: 'education_decouvert_frais' },
  { query: 'Quels prelevements recurrents puis-je arreter facilement ?', expected: 'depenses_abonnements_audit' },
  { query: "Le CCAS peut-il m aider quand je n ai plus d argent ?", expected: 'difficulte_orientation' },
  { query: 'Quelles depenses enlever pour connaitre mon reste a vivre ?', expected: 'budget_reste_a_vivre' },
  { query: 'Un abonnement de streaming est-il une charge fixe ?', expected: 'budget_fixe_variable' },

  // Two-concept questions that must separate neighbouring cards.
  { query: "J ai un pret immo a 1,2 %, je le rembourse plus tot ou je place mon argent ?", expected: 'dette_remboursement_anticipe' },
  { query: 'Assurance emprunteur et frais de dossier comptent-ils dans le prix du credit ?', expected: 'dette_cout_total_credit' },
  { query: 'Je rembourse une dette et je veux aussi epargner, par quoi commencer ?', expected: 'objectif_priorisation' },
  { query: "Faut-il d abord remplir un matelas de securite ou financer un voyage ?", expected: 'objectif_priorisation' },
  { query: 'Mon loyer est fixe mais mes courses changent tout le temps, comment classer tout ca ?', expected: 'budget_fixe_variable' },
  { query: "Quel montant mettre de cote pour un accident de la vie ?", expected: 'epargne_precaution_montant' },
]
