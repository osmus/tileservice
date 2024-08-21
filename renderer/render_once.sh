#!/usr/bin/env bash

# Assumption: planet.osm.pbf is pre-positioned in data/sources

set -x

# Get the directory of the current script
DIR="$(dirname "$0")"

WORKING_DIR="${1:-$DIR}"

DATE="$(date -u '+%Y-%m-%d %H:%M:%S')"
echo "Start Render: $DATE"

mkdir -p "$WORKING_DIR/data/sources"
mkdir -p "$WORKING_DIR/data/tmp"

rm -rf "$WORKING_DIR/data/sources/tmp*.osm.pbf"

pyosmium-up-to-date -vvvv --size 10000 "$WORKING_DIR/data/sources/planet.osm.pbf"

# Remove excess docker files from past runs
docker system prune --force

# Make sure we have the latest planetiler
docker pull ghcr.io/onthegomap/planetiler:latest

docker run -e JAVA_TOOL_OPTIONS='-Xmx2g' \
	-v "$WORKING_DIR/data":/data \
	-v "$DIR/layers":/layers \
	ghcr.io/onthegomap/planetiler:latest --area=planet \
	--download --download-only --only-fetch-wikidata --wikidata-max-age=P30D --wikidata-update-limit=100000

# Remove default downloaded OSM file
rm -rf "$WORKING_DIR/data/sources/monaco.osm.pbf"

PLANET="$WORKING_DIR/data/planet.pmtiles"

docker run -e JAVA_TOOL_OPTIONS='-Xmx150g' \
	-v "$WORKING_DIR/data":/data \
	-v "$DIR/layers":/layers \
	ghcr.io/onthegomap/planetiler:latest --area=planet --bounds=world \
	--output="/data/planet.pmtiles" \
	--force \
	--transportation_name_size_for_shield \
	--transportation_name_limit_merge \
	--boundary-osm-only \
	--storage=ram --nodemap-type=array \
	--max-point-buffer=4 \
	--building_merge_z13=false \
	--languages=ab,ace,af,aht,akz,ale,als,am,an,apj,apm,apw,ar,arp,arz,as,ast,az,az-Arab,az-cyr,azb,ba,bar,bat-smg,be,be-tarask,ber,bg,bla,bm,bn,bo,bpy,br,bs,bxr,ca,cdo,ce,ceb,cho,chr,chy,cic,ckb,cku,co,cow,cr,crh,crh-cyr,crk,cro,cs,csb,cv,cy,da,dak,de,dsb,dv,dz,ee,egl,el,en,eo,es,esk,ess,et,eu,fa,fi,fil,fit,fla,fo,fr,frr,full,fur,fy,ga,gag,gan,gcf,gd,gl,gn,gr,grc,gsw,gu,gv,gwi,ha,haa,hak,hak-HJ,haw,he,hi,hid,hif,hoi,hop,hr,hsb,ht,hu,hup,hur,hy,ia,id,ie,ik,ilo,ing,int,io,is,it,iu,ja,ja_kana,ja_rm,ja-Hira,ja-Latn,jv,ka,kab,kbd,kee,ki,kic,kio,kjq,kk,kk-Arab,kl,km,kn,ko,ko-Hani,ko-Latn,koy,krc,krl,ks,ku,kuu,kv,kw,ky,kyh,la,lb,left,lez,li,lij,lld,lmo,ln,lo,lrc,lt,lut,lv,lzh,md,mdf,mez,mg,mhr,mi,mia,mk,ml,mn,mnr,mo,moh,mr,mrj,ms,ms-Arab,mt,mus,mwl,my,myv,mzn,nah,nan,nan-HJ,nan-POJ,nan-TL,nds,ne,nez,nl,nn,no,nov,nv,oc,oj,oka,old,one,ood,or,os,ota,otw,pa,pam,pao,pcd,pfl,pl,pms,pnb,pot,pqm,ps,pt,pt-BR,pt-PT,qu,right,rm,ro,ru,rue,rw,sac,sah,sal,sat,sc,scn,sco,sd,se,see,sh,shh,si,sju,sk,sl,sma,smj,so,sq,sr,sr-Latn,str,su,sv,sw,syc,szl,ta,tau,tcb,te,TEC,tew,tfn,tg,th,th-Latn,ti,tix,tk,tl,tli,tow,tr,tt,tt-lat,twf,udm,ug,uk,uma,ur,ute,uz,uz-Arab,uz-cyr,uz-Cyrl,uz-Latn,vec,vi,vls,vo,wa,war,win,wiy,wo,wuu,xmf,yak,yi,yo,ypk,yue,yue-Hant,yue-Latn,za,zgh,zh,zh_pinyin,zh_zhuyin,zh-Hans,zh-Hant,zh-Latn-pinyin,zu,zun,zza

# Check if the file exists and is at least 50GB
if [[ ! -f "$PLANET" ]]; then
	echo "Error: File $PLANET does not exist."
	exit 1
elif [[ $(stat -c %s "$PLANET") -lt $((50 * 1024 * 1024 * 1024)) ]]; then
	echo "Error: File $PLANET is smaller than 50GB."
	exit 1
fi

echo 'Uploading planet to s3 bucket in background'
aws s3 cp "$PLANET" s3://osmus-tile/ --only-show-errors &

# Render optional layers
for file in "$DIR/layers/"*.yml; do
	# Get the base name of the file without the .yml extension
	layer_name=$(basename "$file" .yml)

	echo "Processing layer: $layer_name"

	docker run -e JAVA_TOOL_OPTIONS='-Xmx150g' \
		-v "$WORKING_DIR/data":/data \
		-v "$DIR/layers":/layers \
		ghcr.io/onthegomap/planetiler:latest generate-custom \
		--area=planet --bounds=world \
		--output="/data/$layer_name.pmtiles" \
		--force \
		--schema="/layers/$layer_name.yml" \
		--storage=ram --nodemap-type=array \
		--max-point-buffer=4

	echo "Uploading $layer_name to s3 bucket in background"
	{
		aws s3 cp "$WORKING_DIR/data/$layer_name.pmtiles" s3://osmus-tile/ --only-show-errors
		rm -rf "$WORKING_DIR/data/$layer_name.pmtiles"
	} &
done

echo 'Waiting for all background jobs to finish'
wait

echo 'Invalidating the CDN cache'
aws cloudfront create-invalidation --distribution-id E1SJ64GZNQSV8M --invalidation-batch "{\"Paths\": {\"Quantity\": 1, \"Items\": [\"/*\"]}, \"CallerReference\": \"invalidation-$DATE\"}"

echo 'Render Complete'
date -u '+%Y-%m-%d %H:%M:%S'
