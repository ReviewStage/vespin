U="http://localhost:5310/app?fixture=person"
shot() { node app-shot.mjs "$U&office=$1&n=$2" "/tmp/shared/calm-$3.png" $4 $5 $6; }
for v in photo table sentences presence spotlight; do
  shot $v 5 $v-light 1440 900 light
  shot $v 5 $v-dark 1440 900 dark
  shot $v 5 $v-phone 390 844 light
done
shot sentences 5 sentences-phone-dark 390 844 dark
shot spotlight 5 spotlight-phone-dark 390 844 dark
shot photo 10 photo-10 1440 900 light
echo done
