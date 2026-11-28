U="http://localhost:5310/app?fixture=person"
for v in garden track city; do
  node app-shot.mjs "$U&office=$v" /tmp/shared/fun-$v-light.png 1440 900 light
  node app-shot.mjs "$U&office=$v" /tmp/shared/fun-$v-dark.png 1440 900 dark
  node app-shot.mjs "$U&office=$v" /tmp/shared/fun-$v-phone.png 390 844 light
  node rec.mjs "$U&office=$v" /tmp/shared/fun-$v.webm 1440 900 light 5
done
node rec.mjs "$U&office=city" /tmp/shared/fun-city-dark.webm 1440 900 dark 5
node rec.mjs "$U&office=garden" /tmp/shared/fun-garden-phone.webm 390 844 light 5
echo done
