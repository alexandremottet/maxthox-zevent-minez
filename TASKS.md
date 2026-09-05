# Tâches en cours

## Viewer (apps/voxelmap-viewer)

- [x] Liste des POI en overlay sur la carte, clic → déplace la vue vers le POI
- [x] Bouton toolbar pour cacher/afficher la liste
- [x] Bouton toolbar pour cacher certaines couleurs de POI (tout visible par défaut)

## Admin (nouvelle app)

- [x] Nouvelle app `apps/voxelmap-admin`, même style visuel (HUD Minecraft)
- [x] Accès protégé par mot de passe (better-auth + MongoDB, compte unique créé via
      `scripts/seed-admin.mjs`)
- [x] Liste des POI à gauche de la carte
- [x] Bouton "+" vert pixelisé → dialog (vert pixelisé) pour ajouter un POI (clic sur
      la carte pour remplir les coordonnées)
- [x] L'ajout modifie `poi.json` (commit direct sur `main` via l'API GitHub,
      déclenche la CI existante)

Voir `apps/voxelmap-admin/README.md` pour les variables d'env et le setup
Vercel/seed. Étapes manuelles restantes (pas faisables depuis ici) : créer le projet
Vercel, générer le `GITHUB_TOKEN`, lancer le script de seed avec le vrai
`MONGODB_URI`.

### Décisions d'architecture nécessaires avant de commencer l'admin

Le viewer est un site 100% statique (build Astro → GitHub Pages, pas de serveur).
`better-auth` a besoin d'un serveur (routes API) + d'une base de données pour les
sessions. Écrire dans `poi.json` depuis une UI web a besoin d'un backend qui a accès
au fichier — et pour que le viewer (qui embarque `poi.json` au build) se mette à jour,
il faut que la modification déclenche un rebuild/redeploy.

Points à trancher avec l'utilisateur avant d'implémenter :
1. Où l'admin tourne (hébergement avec serveur Node requis, pas GitHub Pages) ?
2. Comment la modification de `poi.json` se propage jusqu'au viewer déployé
   (commit+push via API GitHub → déclenche la CI existante, semble le plus cohérent
   avec l'archi actuelle) ?
