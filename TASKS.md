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
- [x] Les POI vivent dans MongoDB (collection `pois`), fetchés au build par la CI
      (`packages/map-render/scripts/fetch-pois.mjs`) — le viewer déployé reste
      100% statique. L'ajout d'un POI déclenche `deploy.yml` via l'API GitHub
      Actions (workflow_dispatch), pas de commit de fichier.

Voir `apps/voxelmap-admin/README.md` pour les variables d'env et le setup
Vercel/seed. Étapes manuelles restantes (pas faisables depuis ici) : créer le projet
Vercel, générer le `GITHUB_TOKEN` (scope **Actions: write** uniquement), ajouter
`MONGODB_URI` comme secret GitHub Actions, lancer le script de seed.

Les 31 POI existants (`poi.json`) ont été migrés dans la collection `pois` et
vérifiés (round-trip exact) ; `apps/voxelmap-viewer/src/data/` a été supprimé.
