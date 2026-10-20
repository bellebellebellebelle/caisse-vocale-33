# Caisse Vocale (33)

Bonjour. Construction d'un Outils Ultra Smart qui permet à l'utilisateur d'ouvrir sa caisse, d'enregistré des ventes et faire la fermeture de sa caisse. L'outils est connecté à la base de donnée Odoo de l'utilisateur. L'utilisateur appuie sur un bouton de commande vocale pour discuté avec l'outils en langage naturel. L'utilisateur peut demander d' ouvrir un caisse existant dans le module Odoo Point de vente. Ensuite, à chaque fois que l'utilisateur fait une vente il peut dire à l'outils le produit qu'il vient de vendre et il peut dire le prénom et nom du client pour que la vente soit enregistré sur le compte du client ou sinon la vente et enregistré normalement sans client (si pas de prénom et nom cité). Il y a la possibilité de demander la création d'un client en donnant (prénom, nom, et autres infos que l'utilisateur souhaite donner à l'assistant pour la création du client). Lorsque l'utilisateur di un prénom et nom, l'outils peut proposer à l'utilisateur de sélectionné le bon client s'il a un doute entre plusieurs client existant qui pourrai correspondre au client le cas échéant. Puis, lorsque l'utilisateur veut fermer sa caisse il peut dire à l'outils qu'il souhaite fermer sa caisse et de faire les comptes avant la validation de la fermeture. L'outils est très smart il comprend toutes les demandes de l'utilisateur, et l'utilisateur peut parler normalement en langage naturel. L'utilisateur crée un compte pour accéder à l'outils (sans besoin de confirmation par mail, sans besoins de se connecter avec Google). Ajoute les scopes natifs des modules Odoo (Point de vente, Contact, et toutes autres modules que tu jugera nécessaire au bon fonctionnement de l'outils). L'outils doit avoir accès réellement à toutes les fonctionnalités natifs du modules Point de Vente. (regarde ci-joint c'est exactement le rendu visuel que je veux, respect ce visuel en détails). Lovable Cloud est connecté, avec la persistance des données de l'utilisateur en temps réel. Lovable AI est connecté, pour les fonctionnalités intelligentes de l'app. Consigne obligatoire à suivre: Reste sur une implémentation simple, sans ajouter de bibliothèques lourdes, pour optimiser les performances et le coût de génération.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ec1d4469-a33a-4f02-a534-204d14555f5f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
