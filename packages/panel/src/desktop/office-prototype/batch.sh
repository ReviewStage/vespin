set -e
U="http://localhost:5310/app?fixture=person"
shot() { node app-shot.mjs "$U&office=$1&n=$2" "/tmp/shared/office-$3.png" $4 $5 $6; }
shot desks 5 desks-light 1440 1000 light
shot desks 5 desks-dark 1440 1000 dark
shot desks 3 desks-3 1440 900 light
shot desks 10 desks-10 1440 2300 light
shot floor 5 floor-light 1440 1150 light
shot floor 5 floor-dark 1440 1150 dark
shot floor 10 floor-10 1440 2100 light
shot rooms 5 rooms-light 1440 1100 light
shot rooms 5 rooms-dark 1440 1100 dark
shot rooms 10 rooms-10 1440 2000 light
shot rooms 5 phone-rooms 390 1300 light
shot desks 5 phone-desks 390 1300 dark
shot floor 5 phone-floor 390 1300 light
