U="http://localhost:5310/app?fixture=person"
for v in garden city; do
  node crop-shot.mjs "$U&office=$v" /tmp/shared/final-$v-light.png 1440 900 light
  node crop-shot.mjs "$U&office=$v" /tmp/shared/final-$v-dark.png 1440 900 dark
  node crop-shot.mjs "$U&office=$v" /tmp/shared/final-$v-phone.png 390 844 light
  node rec.mjs "$U&office=$v" /tmp/shared/final-$v.webm 1440 900 light 5
done
node rec.mjs "$U&office=city" /tmp/shared/final-city-dark.webm 1440 900 dark 5
node rec.mjs "$U&office=garden" /tmp/shared/final-garden-dark.webm 1440 900 dark 5
echo done
