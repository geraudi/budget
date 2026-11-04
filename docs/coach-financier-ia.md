Pour transformer le modèle de ton application de gestion de budget personnel en un véritable **coach financier, capable de comprendre la situation de l'utilisateur, de lui donner des conseils pertinents et de l'accompagner dans la durée**, je te conseille de ne pas te limiter à améliorer son prompt.

Le plus intéressant serait de construire une approche combinant trois éléments :

1. **Une base de connaissances financières fiables**, adaptée au contexte français.
2. **Une analyse personnalisée du budget**, fondée sur les opérations bancaires et les données calculées par ton application.
3. **Un moteur de conseil conversationnel**, capable d'expliquer les résultats, de proposer des actions concrètes et d'en suivre les effets.

L'objectif n'est pas d'avoir un modèle qui récite des règles financières, mais un modèle qui sait déterminer si ces règles sont pertinentes pour une personne donnée.

## 1. Définir le rôle du coach financier

Je distinguerais quatre niveaux de fonctionnalités.

| Niveau | Fonctionnalité | Exemple |
|---|---|---|
| 1. Comprendre | Expliquer les dépenses et les revenus | « Où est passé mon argent ce mois-ci ? » |
| 2. Diagnostiquer | Identifier les déséquilibres et les habitudes | « Tes dépenses de restauration ont augmenté de 25 % par rapport à ta moyenne des trois derniers mois. » |
| 3. Conseiller | Proposer des actions adaptées à la situation | « En réduisant tes dépenses de restauration de 30 € par mois, tu pourrais économiser 360 € sur un an. » |
| 4. Accompagner | Fixer des objectifs et suivre les progrès | « Tu as atteint 70 % de ton objectif d'épargne mensuel. » |

La différence essentielle entre un assistant classique et un coach financier réside dans la personnalisation.

Un assistant classique explique la règle des 50/30/20. Un coach financier vérifie si cette règle est adaptée au budget de la personne, identifie les écarts et l'aide à progresser sans lui imposer des objectifs irréalistes.

## 2. Construire une base de connaissances financières

C'est probablement le premier chantier à mener.

Les deux articles que tu cites constituent un bon point de départ, mais je te recommande de construire progressivement un corpus structuré plutôt que de fournir simplement des URL au modèle.

### A. Les sources à privilégier

Je commencerais par les ressources suivantes.

| Source | Utilisation dans le coach | Priorité |
|---|---|---|
| [La Finance pour tous](https://www.lafinancepourtous.com/?utm_source=chatgpt.com) | Éducation financière, gestion du budget, épargne et dépenses | Très élevée |
| [Banque de France](https://www.banque-france.fr?utm_source=chatgpt.com) | Informations sur le surendettement, les moyens de paiement et l'éducation financière | Très élevée |
| [Service-Public.fr](https://www.service-public.fr?utm_source=chatgpt.com) | Droits, démarches et dispositifs officiels | Élevée |
| [Mes questions d'argent](https://www.mesquestionsdargent.fr?utm_source=chatgpt.com) | Conseils pratiques et ressources pédagogiques | Élevée |
| [Institut national de la consommation](https://www.inc-conso.fr?utm_source=chatgpt.com) | Consommation, contrats, crédits et maîtrise des dépenses | Complémentaire |

Je privilégierais les sources françaises, institutionnelles ou reconnues, avec une attention particulière à la date de publication et à la date de mise à jour.

### B. Organiser les connaissances par thèmes

Pour commencer, je constituerais les catégories suivantes :

- **Gestion du budget** : revenus, dépenses fixes et variables, reste à vivre, budget prévisionnel.
- **Réduction des dépenses** : abonnements, dépenses récurrentes, achats impulsifs, comparaison des prix.
- **Épargne de précaution** : constitution d'une réserve, régularité et objectifs réalistes.
- **Gestion des dettes** : échéances, coût des crédits, prévention des difficultés de remboursement.
- **Objectifs financiers** : vacances, achat important, travaux, constitution d'une épargne.
- **Éducation financière** : explication des notions et des méthodes budgétaires.
- **Difficultés financières** : prévention du découvert, retards de paiement et orientation vers des organismes compétents.

Chaque connaissance devrait comporter des métadonnées permettant de retrouver les informations utiles.

Par exemple, pour la règle des 50/30/20 :

```json
{
  "id": "budget_rule_50_30_20",
  "title": "La règle des 50/30/20",
  "category": "budget_management",
  "source": "La Finance pour tous",
  "source_url": "https://www.lafinancepourtous.com/outils/questions-reponses/budget-qu-est-ce-que-la-regle-des-50-30-20/",
  "principle": "Répartir indicativement le budget entre besoins essentiels, envies et épargne.",
  "recommendation": {
    "essential_expenses": 50,
    "discretionary_expenses": 30,
    "savings": 20
  },
  "limitations": [
    "Cette répartition est indicative et non obligatoire.",
    "Les proportions doivent être adaptées aux revenus et aux contraintes du foyer.",
    "Les dépenses essentielles peuvent dépasser 50 % du budget."
  ],
  "language": "fr",
  "review_required": true
}
```

Les pourcentages sont ici des repères pédagogiques, pas des objectifs imposés à chaque utilisateur. La source précise elle-même que cette répartition doit être adaptée aux ressources disponibles. [La finance pour tous](https://www.lafinancepourtous.com/outils/questions-reponses/budget-qu-est-ce-que-la-regle-des-50-30-20/?utm_source=chatgpt.com)

Cet exemple illustre aussi un point important : **il faut enregistrer les limites d'une recommandation en même temps que la recommandation elle-même.**

Sinon, le modèle risque de transformer une règle indicative en vérité universelle.

### C. Transformer les articles en connaissances exploitables

Pour chaque article, je conserverais :

1. Le contenu original et sa source.
2. Un résumé fidèle.
3. Les principes financiers qui en découlent.
4. Les conditions dans lesquelles ils sont applicables.
5. Les exceptions et les limites.
6. La date de consultation et, si disponible, la date de mise à jour.

Tu pourrais ensuite créer des fiches de connaissances homogènes à partir de ces documents.

Attention toutefois aux droits de réutilisation : avant d'intégrer intégralement les contenus d'un site dans une application, vérifie les conditions applicables. Une base de connaissances peut aussi s'appuyer sur des résumés originaux et des références vers les sources, sans reproduire systématiquement leurs articles complets.

---

## 3. Utiliser du RAG plutôt que de tout mettre dans le prompt

Si tu utilises un modèle local via Ollama, ou un modèle accessible par API, je te recommande d'étudier le **RAG (Retrieval-Augmented Generation)**, c'est-à-dire la génération augmentée par recherche documentaire.

Le principe est simple :



1. L'utilisateur pose une question.
2. L'application recherche les connaissances pertinentes.
3. Elle sélectionne les passages utiles.
4. Elle transmet ces passages au modèle avec le contexte budgétaire de l'utilisateur.
5. Le modèle formule une réponse personnalisée en s'appuyant sur les informations disponibles.

Prenons cette question :

> Est-ce que je devrais économiser 20 % de mes revenus ?

Sans base documentaire, le modèle risque de donner une réponse générique.

Avec un RAG, il peut retrouver les explications sur la règle des 50/30/20. Puis, en tenant compte du budget de l'utilisateur, il peut expliquer si cet objectif est réaliste.

**Le RAG apporte les connaissances ; les données de l'application permettent la personnalisation.** Ces deux fonctions sont complémentaires.

### Quelle architecture choisir ?

Pour une première version, je partirais sur quelque chose de relativement simple :

- Des documents Markdown ou JSON contenant les connaissances validées.
- Un processus d'indexation pour préparer les documents à la recherche.
- Une recherche lexicale ou hybride, éventuellement complétée par des embeddings.
- Un modèle local ou distant pour générer les réponses.
- Une couche applicative qui fournit les indicateurs budgétaires calculés par ton application.

Tu n'as pas nécessairement besoin d'une base vectorielle complexe dès le début. Un petit corpus de documents bien structurés, associé à une recherche lexicale efficace, peut déjà donner de bons résultats.

## 4. Le plus important : connecter le modèle aux données du budget

À mon avis, c'est ici que tu peux apporter le plus de valeur à ton application.

Un modèle peut connaître toutes les règles de gestion budgétaire. Mais s'il ne dispose pas d'indicateurs fiables sur les finances de l'utilisateur, ses conseils resteront génériques.

Je te conseille donc de séparer **les calculs financiers de leur interprétation par l'IA**.

### A. L'application calcule les indicateurs

Ton application peut calculer elle-même les données suivantes :

| Indicateur | Calcul ou méthode |
|---|---|
| Revenus mensuels moyens | Moyenne des revenus récurrents identifiés |
| Dépenses essentielles | Somme des dépenses classées comme essentielles |
| Dépenses variables | Somme des dépenses variables sur une période |
| Solde mensuel | Revenus moins dépenses |
| Capacité d'épargne observée | Excédent constaté sur une période définie |
| Taux d'épargne | Épargne nette rapportée aux revenus, selon une définition explicite |
| Dépenses récurrentes | Somme des charges régulières |
| Évolution des dépenses | Comparaison avec les périodes précédentes |
| Dépenses annuelles prévisibles | Estimation des dépenses occasionnelles récurrentes |

Il faut définir précisément chaque indicateur. Par exemple, un transfert entre deux comptes appartenant à la même personne ne doit pas être considéré comme une dépense supplémentaire. De même, un remboursement de crédit, un retrait d'espèces et un virement d'épargne doivent être traités avec attention.

Pour les données incertaines, l'application doit aussi transmettre un indicateur de fiabilité.

### B. Le modèle interprète ces indicateurs

Imaginons ce profil budgétaire fictif :

```json
{
  "period": "2026-10",
  "currency": "EUR",
  "monthly_income": 2500,
  "essential_expenses": 1550,
  "discretionary_expenses": 650,
  "savings": 100,
  "monthly_balance": 200,
  "data_quality": {
    "months_available": 6,
    "income_classification_confidence": 0.98,
    "expense_classification_confidence": 0.91
  }
}
```

L'utilisateur demande :

> Est-ce que je gère bien mon budget ?

Un modèle générique pourrait répondre :

« Essayez de respecter la règle des 50/30/20 et d'épargner 20 % de vos revenus. »

Un coach financier devrait plutôt répondre quelque chose comme :

> Ton budget présente un excédent de 200 € ce mois-ci, ce qui est encourageant.
>
> Tes dépenses essentielles représentent environ 62 % de tes revenus, contre 26 % pour tes dépenses variables. Tu épargnes actuellement 4 % de tes revenus.
>
> La règle des 50/30/20 pourrait te servir de repère, mais tes dépenses essentielles dépassent déjà son objectif indicatif de 50 %. Ce n'est pas nécessairement un problème : ton logement ou tes transports peuvent expliquer cet écart.
>
> **Mon conseil :** avant de chercher à réduire toutes tes dépenses, vérifions si tes dépenses variables contiennent quelques postes sur lesquels tu pourrais économiser sans trop modifier ton quotidien.
>
> Si ton budget le permet, tu pourrais ensuite essayer de porter ton épargne mensuelle de 100 € à 120 €, puis réévaluer cet objectif après un ou deux mois.

L'intérêt n'est pas simplement d'obtenir une réponse plus longue. Le modèle utilise les chiffres, reconnaît les limites de son analyse et propose une prochaine étape raisonnable.

Il faut néanmoins éviter de présenter un excédent mensuel ponctuel comme une capacité d'épargne durable. Ici, les six mois d'historique doivent servir à vérifier la stabilité de la situation.

---

## 5. Donner au modèle une véritable méthode de coaching

Je mettrais en place une méthode de raisonnement structurée, que tu pourras faire évoluer en fonction des résultats.

Pour chaque question nécessitant un conseil personnalisé, le modèle devrait suivre ces étapes.

### Étape 1 — Comprendre la demande

L'utilisateur veut-il :
- comprendre ses dépenses ;
- résoudre un problème de budget ;
- économiser davantage ;
- financer un projet ;
- ou simplement obtenir une explication ?

Il ne faut pas proposer systématiquement un plan d'économies à quelqu'un qui demande seulement une explication.

### Étape 2 — Établir le diagnostic

Le modèle examine les données disponibles :
- évolution des revenus et des dépenses ;
- charges récurrentes ;
- dépenses exceptionnelles ;
- objectifs connus ;
- qualité et ancienneté des données.

Il doit distinguer les faits observés des hypothèses.

### Étape 3 — Sélectionner les connaissances utiles

Le système recherche les règles et recommandations qui correspondent au problème.

Par exemple :
- règle des 50/30/20 pour analyser la répartition du budget ;
- constitution progressive d'une épargne de précaution ;
- anticipation des dépenses annuelles ;
- analyse des dépenses récurrentes pour rechercher des économies.

Le modèle ne doit pas appliquer toutes ces méthodes simultanément.

### Étape 4 — Formuler une recommandation adaptée

Une bonne recommandation devrait contenir :
1. Un constat chiffré.
2. Une explication compréhensible.
3. Une action concrète.
4. Un objectif réaliste.
5. Une limite ou une réserve lorsque cela est nécessaire.

### Étape 5 — Accompagner l'utilisateur

Le coach peut proposer une action, puis mesurer son résultat lors d'une conversation ultérieure.

Par exemple :

- Objectif : réduire les dépenses de restauration de 30 € par mois.
- Période : un mois.
- Résultat : dépenses réduites de 24 €.
- Prochaine étape : déterminer si cet effort est tenable ou s'il faut ajuster l'objectif.

L'accompagnement ne doit pas devenir culpabilisant. Un objectif manqué est une information qui permet d'ajuster le plan, pas une faute de l'utilisateur.

---

## 6. Un prompt système adapté à ton application

Voici une première base que tu pourrais tester avec ton modèle actuel.

Je te recommande de séparer le comportement général du coach des données budgétaires et des documents récupérés. Cela te permettra de modifier les connaissances sans réécrire toutes les instructions.

# Rôle

Tu es un coach financier personnel spécialisé dans la gestion du budget des particuliers en France.

Ta mission est d'aider l'utilisateur à comprendre ses finances, à prendre de meilleures décisions budgétaires et à progresser vers ses objectifs financiers.

Tu adoptes une approche pédagogique, bienveillante, pragmatique et personnalisée.

Tu n'es pas là pour juger les dépenses de l'utilisateur ni pour lui imposer un mode de vie.

# Sources d'information

Tu disposes potentiellement de trois catégories d'informations :

1. Les données budgétaires calculées par l'application.
2. Les informations fournies par l'utilisateur.
3. Une base de connaissances financières contenant des recommandations documentées et leurs sources.

Utilise ces informations de manière complémentaire.

Les données budgétaires permettent de comprendre la situation individuelle.

La base de connaissances permet d'identifier les méthodes et recommandations pertinentes.

Les informations fournies par l'utilisateur permettent de tenir compte de ses priorités et contraintes.

Ne prétends jamais avoir accès à une information qui ne t'a pas été transmise.

# Méthode d'analyse

Lorsqu'une question nécessite une analyse personnalisée :

1. Identifie le besoin de l'utilisateur.
2. Examine les données budgétaires disponibles et leur qualité.
3. Identifie les faits pertinents et les éventuelles incertitudes.
4. Recherche les recommandations adaptées dans la base de connaissances lorsqu'elle est disponible.
5. Évalue si ces recommandations sont applicables à la situation observée.
6. Formule une réponse claire et, si pertinent, une action concrète.
7. Propose une prochaine étape lorsque cela peut aider l'utilisateur.

Ne suis pas mécaniquement une méthode budgétaire. Adapte les recommandations aux revenus, aux charges, aux objectifs et aux contraintes de l'utilisateur.

# Fiabilité

Ne fabrique jamais de chiffres, de transactions, de statistiques ou de références documentaires.

Utilise exclusivement les chiffres calculés par l'application ou les informations explicitement fournies.

N'invente pas les données manquantes.

Si les informations sont insuffisantes pour établir un diagnostic fiable, indique les limites de l'analyse et demande uniquement les précisions nécessaires.

Distingue clairement :
- les faits observés ;
- les estimations ;
- les hypothèses ;
- les recommandations.

Ne présente pas une corrélation comme une causalité.

Ne tire pas de conclusion durable à partir d'un seul mois de données lorsque plusieurs périodes sont nécessaires.

# Principes de coaching

Privilégie des conseils :
- personnalisés ;
- concrets ;
- réalistes ;
- progressifs ;
- compatibles avec les contraintes connues ;
- compréhensibles sans connaissances financières particulières.

Lorsque c'est pertinent, présente une ou deux actions prioritaires plutôt qu'une longue liste de recommandations.

Chiffre les bénéfices potentiels uniquement lorsque les données permettent de le faire.

Précise lorsqu'un gain annoncé est une estimation et non une économie garantie.

Ne considère pas automatiquement une dépense comme inutile parce qu'elle est élevée.

Distingue les dépenses essentielles, les dépenses variables et les dépenses exceptionnelles lorsque les données le permettent.

Ne présente jamais une règle budgétaire indicative comme une obligation universelle.

# Personnalisation

Tiens compte des objectifs financiers explicitement communiqués par l'utilisateur.

Si ses priorités ne sont pas connues et influencent sensiblement la recommandation, pose une question ciblée.

Ne suppose pas qu'il souhaite maximiser son épargne au détriment de son confort de vie.

Respecte ses choix et explique les compromis possibles sans jugement.

# Gestion des risques

Ne recommande pas de contracter un crédit pour masquer un déséquilibre budgétaire sans examiner ses conséquences.

Ne recommande pas de suspendre des paiements essentiels sans évaluer les risques associés.

En présence de difficultés financières importantes, de retards de paiement ou d'un risque de surendettement, privilégie les mesures de prévention et oriente vers les organismes compétents.

Ne présente pas des recommandations générales de gestion budgétaire comme un conseil personnalisé en investissement, fiscalité ou droit.

Pour les questions dépassant ton périmètre, explique les limites de ton rôle et recommande une source officielle ou un professionnel compétent.

# Style de réponse

Réponds dans la langue de l'utilisateur.

Adopte un ton naturel, accessible, encourageant et professionnel.

Évite le jargon financier. Explique les termes techniques lorsqu'ils sont nécessaires.

Commence par répondre directement à la question.

Lorsque l'utilisateur demande une analyse personnalisée, privilégie cette structure :

1. Constat : ce que montrent les données.
2. Interprétation : ce que cela signifie.
3. Conseil : ce que l'utilisateur peut envisager.
4. Prochaine étape : une action ou une question utile.

Adapte la longueur de la réponse à la complexité de la demande.

Ne force pas cette structure pour les questions simples.

# Transparence

Lorsque tu utilises une recommandation issue de la base de connaissances, cite la source si elle est disponible.

Si une source manque ou si les informations disponibles sont contradictoires, indique-le plutôt que d'inventer une justification.

N'affirme jamais qu'une action a été effectuée dans l'application si elle ne l'a pas réellement été.

Ce prompt constitue une bonne base, mais **il ne garantit pas à lui seul la qualité des réponses**. Il faudra le tester sur des situations réelles ou synthétiques et mesurer les erreurs, les conseils trop génériques et les recommandations inadaptées.

---

## 7. Séparer les calculs, les connaissances et la génération de texte

Pour obtenir des résultats fiables, je ne confierais pas tous les calculs au modèle.

Je structurerais le système en trois composants.

### Composant A — Le moteur budgétaire

Il est responsable des calculs exacts :
- sommes et moyennes ;
- évolution des dépenses ;
- taux budgétaires ;
- détection des dépenses récurrentes ;
- projections ;
- comparaison entre budget prévu et budget réel.

Ces résultats sont transmis au modèle sous forme de données structurées.

### Composant B — La base de connaissances

Elle fournit :
- les principes budgétaires ;
- les recommandations documentées ;
- les conditions d'application ;
- les limites ;
- les sources.

### Composant C — Le coach conversationnel

Il utilise les deux autres composants pour produire une réponse contextualisée.

Il peut également demander à l'application de calculer un indicateur supplémentaire si ton architecture lui donne accès à des outils appropriés.

Pour une application utilisant Ollama, les fonctions de sortie structurée et d'appel d'outils peuvent faciliter cette intégration. La documentation officielle décrit ces possibilités. [Ollama](https://ollama.com/blog/structured-outputs?utm_source=chatgpt.com)

Cette séparation présente un avantage majeur : tu peux améliorer les calculs sans modifier le prompt, enrichir la base documentaire sans changer le moteur budgétaire et changer de modèle sans réécrire toute l'application.

---

## 8. Prévoir la confidentialité dès la conception

Les données bancaires méritent une attention particulière.

Dans ton application, le modèle n'a généralement pas besoin de connaître le nom du commerçant, l'identité du bénéficiaire d'un virement ou les libellés bancaires complets pour calculer un taux d'épargne.

Pour beaucoup de questions, des données agrégées suffisent.

Par exemple, pour analyser les dépenses de restauration, il peut être suffisant de transmettre les montants mensuels par catégorie plutôt que chaque opération bancaire.

Je recommande donc de :

- Limiter les données envoyées au modèle à ce qui est nécessaire.
- Éviter de transmettre les identifiants bancaires et les libellés personnels lorsqu'ils ne sont pas utiles.
- Privilégier les agrégats calculés côté application.
- Protéger l'historique des conversations et les éventuelles mémoires du coach.
- Définir une durée de conservation appropriée.
- Vérifier les conditions de conservation et d'utilisation des données si tu utilises une API externe.

Ces précautions correspondent notamment aux recommandations de la CNIL sur la minimisation des données et la protection de la vie privée dès la conception. [CNIL](https://www.cnil.fr/fr/developpement-des-systemes-dia-les-recommandations-de-la-cnil-pour-respecter-le-rgpd?utm_source=chatgpt.com)

---

## 9. Comment vérifier que le coach est réellement meilleur ?

Je créerais un jeu de tests avant d'investir beaucoup de temps dans le développement de la base documentaire.

Voici quelques scénarios à tester :

| Scénario | Résultat attendu |
|---|---|
| Budget équilibré, épargne faible | Identifier les possibilités d'amélioration sans imposer 20 % d'épargne |
| Charges essentielles élevées | Reconnaître les contraintes et éviter les objectifs irréalistes |
| Hausse ponctuelle des dépenses | Vérifier si elle est exceptionnelle avant de proposer une réduction |
| Dépenses récurrentes importantes | Identifier des pistes d'analyse concrètes |
| Historique incomplet | Signaler les limites plutôt que conclure trop rapidement |
| Objectif d'épargne précis | Calculer un effort mensuel réaliste à partir des données disponibles |
| Solde négatif plusieurs mois de suite | Prioriser la stabilisation du budget |
| Question générale sur la règle des 50/30/20 | Expliquer la méthode, ses avantages et ses limites |
| Question sans rapport avec les finances personnelles | Répondre brièvement ou expliquer les limites du périmètre |

Pour chaque scénario, je noterais notamment :

- La justesse des chiffres.
- La pertinence du diagnostic.
- La qualité de la personnalisation.
- La faisabilité des conseils.
- La fidélité aux sources.
- La capacité à reconnaître les informations manquantes.
- Le ton et la clarté de la réponse.

Je conserverais ensuite ces cas comme tests de non-régression lors des changements de prompt, de modèle ou de base de connaissances.

---

# 10. Ce que je ferais concrètement à ta place

Je commencerais par une première version limitée, mais bien conçue.

**Phase 1 — Améliorer les réponses**
- Définir le prompt système.
- Structurer les indicateurs budgétaires transmis au modèle.
- Créer une dizaine de scénarios de test.

**Phase 2 — Ajouter les connaissances**
- Collecter une première sélection de ressources fiables.
- Les convertir en fiches documentaires.
- Mettre en place la recherche documentaire.
- Ajouter les sources aux réponses lorsque c'est pertinent.

**Phase 3 — Personnaliser le coaching**
- Identifier les objectifs de l'utilisateur.
- Suivre les recommandations précédentes.
- Mesurer les résultats.
- Ajuster les objectifs dans le temps.

**Phase 4 — Fiabiliser le système**
- Tester les réponses sur des cas limites.
- Contrôler les calculs.
- Vérifier la confidentialité.
- Mesurer les régressions lors des changements de modèle.

Je ne commencerais pas par du fine-tuning. Pour ce cas d'usage, un bon prompt, des données budgétaires fiables, une base de connaissances correctement structurée et des tests de qualité sont une première étape plus facile à contrôler.

---

## Pour aller plus loin : j'aurais besoin de trois précisions

Je peux maintenant t'aider à concevoir une architecture plus concrète, adaptée à ton application, plutôt que de rester sur des recommandations générales.

**1. Quel modèle utilises-tu actuellement ?**

Par exemple :
- Ollama avec un modèle local comme Qwen ou Gemma ;
- une API distante ;
- un modèle sélectionnable par l'utilisateur.

**2. Comment le modèle reçoit-il actuellement les informations budgétaires ?**

- A. Uniquement la question de l'utilisateur.
- B. La question et un résumé des revenus et dépenses.
- C. La question et les opérations bancaires détaillées.
- D. Un système d'outils permet au modèle d'interroger l'application.

**3. Quel type de coach souhaites-tu obtenir en priorité ?**

- **A. Coach pédagogique** : explique les règles financières et aide à mieux comprendre son budget.
- **B. Coach analytique** : analyse les dépenses, détecte les anomalies et propose des économies.
- **C. Coach personnel** : accompagne l'utilisateur dans la durée, mémorise ses objectifs et adapte ses recommandations.
- **D. Les trois**, dans une architecture commune.

Avec ces trois réponses, je pourrai te proposer une architecture technique précise, notamment la structure des documents, la stratégie RAG, le prompt adapté et le format des données à transmettre au modèle.


Autre idées en vrac:
- structurer un tableau de budget mensuel (50/30/20) adapté à vos revenus
- calculer l'impact de l'inflation sur votre épargne actuelle ?
- trouver les aides sociales auquels j'ai droits en fonction de mes revenus (model: https://money.wizbii.com/advices/comment-fonctionne-simulateur-wizbii)

---

## Implémentation dans budget-app (2026-11-01)

**Phases livrées.** La phase A (corpus de fiches + RAG lexical), la phase B
(indicateurs vérifiés et classification), la phase C (fusion coach) et la phase
D (objectifs et journal de recommandations, commit `e771ecd`) sont terminées.
La phase E (éval & confidentialité) a été implémentée et vérifiée le
2026-11-02 : elle n'ajoute aucune fonctionnalité métier et aucune migration.

**Ce qui est réellement envoyé au modèle.**

- les indicateurs agrégés (`AnalyticsIndicators`) : revenus qualifiés et non
  qualifiés, dépenses par nature, épargne observée, virements, récurrences par
  catégorie et indicateurs de qualité des données ;
- les objectifs suivis : `id` et libellé saisis par l'utilisateur, montants,
  échéance, effort mensuel, capacité observée, réalisme et raisons ;
- les fiches de connaissances retrouvées (top 4), avec leur source et leurs
  limites.

**Ce qui n'est pas envoyé.** Les libellés bancaires (`libelleSimplifie`,
`libelleOperation`), les références, les informations complémentaires, les
identifiants d'opération, `topExpenses` et les noms de commerçants. Le modèle
raisonne uniquement par catégorie et par nature. Le journal
`coach_recommendations` ne stocke que le payload agrégé reconstruit côté serveur
par `buildRecommendationPayload`, jamais la réponse du modèle.

**Transcript.** Il reste local au navigateur, par période
(`budget-coach:<periodKey>`). D.5 (mémoire serveur du transcript) n'est pas fait :
aucune table de conversation n'existe.

**Évaluation.** `pnpm test:coach` exécute hors ligne les 10 scénarios de la §9 et
l'audit de confidentialité. Aucun appel Ollama, aucun accès à une base de
données fichier. `pnpm test:coach -- --live` envoie les prompts à `qwen3:14b`
pour une inspection manuelle, sans assertion sémantique. Le test bloquant
`src/eval/coach/privacy.test.ts` échoue si un libellé, une référence, un
identifiant d'opération ou `topExpenses` apparaît dans le payload, le prompt,
les sources ou le journal.
