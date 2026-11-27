U="http://localhost:5310/app?fixture=person"
for v in hilltop board standup; do
  node app-shot.mjs "$U&office=$v" /tmp/shared/ref-$v-light.png 1440 1000 light
  node app-shot.mjs "$U&office=$v" /tmp/shared/ref-$v-dark.png 1440 1000 dark
  node app-shot.mjs "$U&office=$v" /tmp/shared/ref-$v-phone.png 390 1100 light
  node app-shot.mjs "$U&office=$v" /tmp/shared/ref-$v-phone-dark.png 390 1100 dark
done
echo done
