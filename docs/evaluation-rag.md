# Évaluation du retrieval RAG

Ce document explique comment est mesurée la qualité de la recherche documentaire
(« retrieval ») du coach : jeu de questions, rangs, `recall@k`, MRR, seuils et
lecture des résultats.

Fichiers concernés :

- `src/domain/knowledge/eval-set.ts` — les 50 questions et leur fiche attendue ;
- `src/domain/knowledge/eval-set.test.ts` — le test de garde du jeu d’éval ;
- `scripts/knowledge-eval.ts` — le calcul des métriques ;
- `src/domain/knowledge/search.ts` — la recherche lexicale BM25 ;
- `src/domain/knowledge/embedding.ts` — la recherche vectorielle et la fusion RRF ;
- `src/infrastructure/knowledge/retrieval.ts` — le retrieval par défaut de l’application.

## 1. Le jeu d’éval

Chaque cas est une paire :

```ts
{
  query: 'Combien de mois de depenses dois-je garder en cas de coup dur ?',
  expected: 'epargne_precaution_montant',
}
```

- `query` : la question telle qu’un utilisateur l’écrirait.
- `expected` : l’id de la fiche qui doit être retrouvée. C’est la vérité terrain.
- Une seule fiche attendue par question : l’éval mesure la capacité à retrouver
  **la bonne fiche**, pas à juger une réponse générée.

Le test de garde vérifie que les 50 `expected` existent réellement dans le
corpus, que chaque fiche est couverte par au moins une question, que les requêtes
sont uniques et non vides, et qu’aucune requête ne réutilise un titre de fiche.

## 2. La boucle d’évaluation

Pour chaque question et chaque stratégie :

```ts
const matches = search(query, { limit: 5 })
const rank = matches.findIndex((match) => match.entry.id === expected) + 1
// rank = 1 si la fiche est première
// rank = 0 si elle n’est pas dans le top 5
```

On obtient une liste de rangs, par exemple :

```text
[1, 1, 2, 1, 3, 1, 0, 1, 2, 1, ...]
```

Toutes les métriques sont calculées à partir de ces rangs.

## 3. Recall@k

**Recall@k = proportion de questions dont la bonne fiche est dans le top k.**

```text
recall@k = nombre de rangs entre 1 et k / nombre total de questions
```

Exemple sur 50 questions :

- 42 fois la fiche est en rang 1 ;
- 7 fois en rang 2 ou 3 ;
- 1 fois absente du top 5.

Alors :

```text
recall@1 = 42 / 50 = 84 %
recall@3 = 49 / 50 = 98 %
recall@5 = 49 / 50 = 98 %
```

C’est exactement le résultat hybride actuel.

Points importants :

- `recall@1` est très strict : seule la première fiche compte ;
- `recall@3` tolère deux fiches devant la bonne ;
- `recall@5` tolère quatre fiches devant ;
- un rang 1 et un rang 3 comptent **pareil** pour `recall@3` : les deux sont des
  succès.

`recall@k` seul ne dit donc pas si la bonne fiche est en tête ou juste dans le
peloton.

## 4. MRR

**MRR = Mean Reciprocal Rank** : moyenne de l’inverse du rang.

```text
MRR = moyenne(1 / rank)
```

avec `1 / rank = 0` si la fiche est absente.

Contribution d’une question :

| Rang de la bonne fiche | Contribution au MRR |
|---:|---:|
| 1 | 1,000 |
| 2 | 0,500 |
| 3 | 0,333 |
| 4 | 0,250 |
| 5 | 0,200 |
| absente | 0 |

Le MRR **récompense fortement le fait de mettre la bonne fiche en premier**,
contrairement au recall@k qui est binaire.

Exemple avec 50 questions : si 42 sont au rang 1, 6 au rang 2, 1 au rang 3 et
1 au rang 4 :

```text
MRR = (42×1 + 6×0,5 + 1×0,333 + 1×0,25) / 50
    = 45,583 / 50
    ≈ 0,912
```

C’est cohérent avec les valeurs observées : lexical 0,835, hybride 0,907,
embedding 0,925.

Comme les rangs ne sont calculés que sur le top 5, il s’agit de fait d’un
**MRR@5** : une fiche absente du top 5 compte 0.

## 5. Pourquoi les deux métriques ?

Elles répondent à deux questions différentes :

- `recall@k` : « est-ce que la bonne fiche est disponible dans les k premières ? »
- `MRR` : « à quelle hauteur du classement est-elle, en moyenne ? »

Un moteur peut avoir un bon `recall@3` mais un mauvais MRR s’il met souvent la
bonne fiche en 3e position. Inversement, un moteur peut avoir un excellent MRR
mais rater complètement quelques questions, ce que le recall@5 révèle.

C’est pour cela que le script affiche les trois recall et le MRR.

## 6. Seuils

Le script affiche et applique :

```text
recall@3 ≥ 90 %
recall@5 ≥ 95 %
```

Sur 50 questions, cela signifie :

- au moins **45/50** dans le top 3 ;
- au moins **48/50** dans le top 5.

Justification :

- le coach injecte les **4 premières fiches** dans le contexte ;
- un recall@3 de 90 % laisse une petite tolérance sans accepter un moteur qui
  rate régulièrement ;
- un recall@5 de 95 % évite qu’une fiche attendue soit pratiquement
  indisponible ;
- l’ancien seuil de 100 % recall@3 était calibré sur 20 questions faciles, une
  par fiche. Avec 30 questions de paraphrase, de typo et à deux concepts, 100 %
  n’est plus un seuil réaliste — mais il n’a pas été abaissé en silence : il est
  affiché et justifié.

En mono-stratégie, un seuil non atteint fait sortir le script en erreur. En mode
`--compare`, le script échoue seulement si aucune stratégie n’atteint le seuil.

## 7. Ce que fait chaque stratégie

- **lexical** : BM25 sur titre, tags, id et corps de fiche, avec normalisation
  des accents et petites synonymies. Déterministe, sans dépendance réseau.
- **embedding** : similarité cosinus entre le vecteur de la question et les
  vecteurs précalculés des fiches avec `bge-m3`. Nécessite `embeddings.json` et
  Ollama.
- **hybride** : lance lexical et embedding séparément, puis fusionne les deux
  classements par **Reciprocal Rank Fusion** :

```text
score = Σ 1 / (60 + rang)
```

La fiche bien classée dans les deux classements remonte. Cela évite d’avoir à
normaliser un score BM25 et un score cosinus.

## 8. Lecture des résultats actuels

`pnpm knowledge:eval --compare`, Ollama lancé, `bge-m3`, 20 fiches / 50 questions :

| Stratégie | recall@1 | recall@3 | recall@5 | MRR | Temps approx. / question |
|---|---:|---:|---:|---:|---:|
| lexical | 74,0 % | 96,0 % | 98,0 % | 0,835 | ~1,2 ms |
| embedding | 86,0 % | 98,0 % | 100,0 % | 0,925 | ~41,6 ms |
| hybride | 84,0 % | 98,0 % | 98,0 % | 0,907 | ~42,3 ms |

Interprétation :

- lexical trouve 37/50 en premier, 48/50 dans le top 3, 49/50 dans le top 5 ;
- hybride trouve 42/50 en premier, 49/50 dans le top 3, 49/50 dans le top 5 ;
- embedding trouve 43/50 en premier, 49/50 dans le top 3, 50/50 dans le top 5 ;
- hybride et lexical partagent le même échec :
  `Combien de mois de depenses dois-je garder en cas de coup dur ?` ;
- embedding rattrape cette question au rang 2, mais descend une autre au rang 4.

La liste « Échecs recall@3 » affichée par le script correspond simplement aux
rangs `0` ou `> 3`.

## 9. Temps de réponse

Le script mesure :

- la boucle de recherche de chaque stratégie, divisée par le nombre de
  questions ;
- la vectorisation des requêtes, mesurée en un seul lot puis divisée par le
  nombre de questions.

Le temps embedding/hybride inclut donc la vectorisation de la requête. C’est un
ordre de grandeur destiné à comparer les stratégies, pas un benchmark réseau
strict.

## 10. Limites

- Un seul `expected` par question : l’éval est stricte et ne modélise pas les
  questions où plusieurs fiches seraient acceptables.
- Elle mesure le **retrieval**, pas la qualité de la réponse générée par le
  modèle.
- Le MRR dépend du top 5 : une fiche en rang 6 est traitée comme absente.
- Les questions difficiles ont été conservées : les échecs résiduels sont
  documentés plutôt que supprimés pour obtenir 100 %.

## 11. Commandes

```bash
pnpm knowledge:eval                     # stratégie par défaut (hybride)
pnpm knowledge:eval --strategy=lexical  # lexical seul, sans Ollama
pnpm knowledge:eval --strategy=embedding
pnpm knowledge:eval --compare           # lexical / embedding / hybride
```

## 12. Fondements théoriques

Les métriques utilisées ici ne sont pas propres au RAG : elles viennent de
l’évaluation classique de la recherche d’information.

- **Cranfield / TREC** : le protocole consiste à figer une collection, des
  requêtes et des jugements de pertinence (*qrels*), puis à mesurer le classement
  renvoyé. Notre jeu de 50 questions suit ce principe à petite échelle.
- **Recall / precision** : définies sur l’ensemble des documents pertinents.
  Le recall mesure ce qui est retrouvé, la precision ce qui est renvoyé à tort.
- **MRR** : popularisé par la campagne TREC Question Answering (Voorhees, 1999),
  adapté aux systèmes qui doivent renvoyer une bonne réponse en tête.
- **RRF** : proposé par Cormack, Clarke et Buettcher (SIGIR 2009) pour fusionner
  des classements dont les scores ne sont pas comparables.

Attention : comme chaque question n’a **qu’une seule fiche attendue**, notre
`recall@k` est en réalité un **hit rate / success@k** :

```text
recall@k = proportion de questions dont le rang est ≤ k
```

Ce n’est pas le recall multi-documents de TREC. C’est volontaire : le coach
injecte les meilleures fiches, pas une liste exhaustive. Cette métrique ne dit
rien non plus de la qualité de la réponse générée par le modèle.

## 13. Ressources

### Cours et livres

- [Text Retrieval and Search Engines — ChengXiang Zhai, Coursera](https://www.coursera.org/learn/text-retrieval)
  — cours complet ; l’évaluation (precision, recall, MAP, pertinence) est traitée
  en semaine 3.
- [Search Engines: Information Retrieval in Practice — gratuit](https://ciir.cs.umass.edu/irbook/)
  — livre téléchargeable, avec un chapitre dédié à l’évaluation.
- [Introduction to Information Retrieval — Manning, Raghavan, Schütze](https://nlp.stanford.edu/IR-book/)
  — référence canonique ; chapitre 8 « Evaluation in information retrieval ».
  Le site était injoignable depuis l’environnement de développement au moment de
  la rédaction, mais le livre reste la source standard.
- [TREC](https://trec.nist.gov/) — campagnes d’évaluation réelles, qrels et
  pistes QA/retrieval.

### Articles

- [Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
  — Cormack, Clarke, Buettcher, SIGIR 2009. Papier original du RRF.
- [BEIR: A Heterogenous Benchmark for Zero-shot Evaluation of Information Retrieval Models](https://arxiv.org/abs/2104.08663)
  — benchmark zero-shot de modèles de retrieval.
- [MTEB: Massive Text Embedding Benchmark](https://arxiv.org/abs/2210.07316)
  — benchmark des embeddings, utile pour situer `bge-m3`.
- [Mean reciprocal rank](https://en.wikipedia.org/wiki/Mean_reciprocal_rank)
  — définition et exemple.
- [Ragas](https://docs.ragas.io/) — évaluation de bout en bout d’un pipeline RAG
  (retrieval + génération), pour la couche qui n’est pas couverte ici.

### Vidéos

Metrics de retrieval :

- [RAG Retrieval Metrics Explained: Recall, Precision, MRR & NDCG](https://youtu.be/1M24UHWL41A)
  — KodeKloud. Le plus directement aligné avec notre cas.
- [Recall@k, Precision@k, MRR et nDCG](https://youtu.be/Zg0do894s9w)
  — formats `@k`, proches de nos `recall@3` et `recall@5`.
- [Evaluation Measures for Search and Recommender Systems](https://youtu.be/BD9TkvEsKwM)
  — James Briggs. Panorama des mesures.
- [Mean Reciprocal Rank (MRR): Evaluating a Retrieval System](https://youtu.be/8y9bi2vIG4U)
  — explication courte et concrète du MRR.

Cours d’IR :

- [Evaluation 1: overview](https://youtu.be/K-eM3eLIEpw) — Victor Lavrenko.
  Le cadre expérimental de l’IR.
- [Evaluation 6: precision and recall](https://youtu.be/mctizdBujk4) — Victor
  Lavrenko. Construction des deux métriques.

RRF et recherche hybride :

- [Understanding Reciprocal Rank Fusion in Hybrid Search](https://youtu.be/6dDvfGrxFns)
  — TechViz. Explique le `k = 60` et le comportement de la fusion.
- [What is reciprocal rank fusion in hybrid search?](https://youtu.be/2uBcjEecr38)
  — Abhishek Thakur. Version courte.

Ordre de lecture conseillé : la vidéo KodeKloud pour l’intuition, le cours
Coursera (semaine 3) pour formaliser, le chapitre 8 de Manning pour les
définitions exactes, puis le papier RRF pour justifier l’hybride.
