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
	--languages=aaq,ab,abe,ace,af,aht,akz,ale,alg,alq,als,am,an,apj,apm,apw,ar,arp,arz,as,asb,ast,atj,az,az-Arab,az-Cyrl,az-Latn,azb,ba,bar,be,be-tarask,bea,ber,bg,bla,bm,bn,bo,bpy,br,bs,bxr,ca,cay,cdo,ce,ceb,cho,chp,chr,chy,cic,ckb,cku,clc,cmn,co,coo,cow,cr,cr-Latn,crg,crh,crh-Cyrl,crj,crk,crl,crm,cro,cs,csb,csw,cv,cwd,cy,da,dak,de,del,den,dgr,dsb,dv,dz,ee,egl,el,en,eo,es,esk,ess,esu,et,eu,fa,fi,fil,fit,fla,fo,fr,frr,fur,fy,ga,gag,gan,gcf,gd,git,gl,gn,gr,grc,gsw,gu,gv,gwi,ha,haa,hai,hak,hak-Hant,haw,he,hei,hi,hid,hif,hoi,hop,hr,hsb,ht,hu,hup,hur,hy,ia,id,ie,ik,ike,ikt,ilo,ing,int,io,is,it,iu,iu-Latn,ja,ja-Hira,ja-Latn,jv,ka,kab,kbd,kee,ki,kic,kio,kjq,kk,kk-Arab,kk-Cyrl,kk-Latn,kl,km,kn,ko,ko-Hani,ko-Latn,koy,krc,krl,ks,ku,kuu,kv,kw,kwk,ky,kyh,la,lb,lez,li,lij,lil,lkt,lld,lmo,ln,lo,lrc,lt,lut,lv,lzh,md,mdf,mez,mg,mhr,mi,mia,mic,mk,ml,mn,mnr,mo,moe,moh,mr,mrj,ms,ms-Arab,mt,mus,mwl,my,myv,mzn,nah,nan,nan-Hant,nan-Latn-pehoeji,nan-Latn-tailo,ncg,nds,ne,nez,nl,nn,no,nov,nsk,nuk,nv,oc,oj,ojb,ojg,oji,ojs,ojw,oka,old,one,ono,ood,or,os,ota,otw,pa,pam,pao,pcd,pfl,pl,pms,pnb,pot,pqm,ps,pt,pt-BR,pt-PT,ptw,qu,rm,ro,ru,rue,rw,sac,sah,sal,sat,sc,scn,sco,scs,sd,se,sec,see,sgs,sh,shh,shs,si,sju,sk,sl,sma,smj,so,sq,squ,sr,sr-Latn,srs,sto,str,su,sv,sw,syc,szl,ta,tau,tcb,te,tew,tfn,tg,th,th-Latn,thp,ti,tix,tk,tl,tli,tow,tr,tsi,tt,tt-Arab,tt-Cyrl,tt-Latn,tus,twf,udm,ug,uk,uma,umu,ur,ute,uz,uz-Arab,uz-Cyrl,uz-Latn,vec,vi,vi-Hani,vls,vo,wa,war,win,wiy,wo,wuu,wya,xmf,xsl,yak,yi,yo,ypk,yue,yue-Hans,yue-Hant,yue-Latn,yue-Latn-HK,yue-Latn-jyutping,za,zgh,zh,zh-Bopo,zh-Hans,zh-Hans-CN,zh-Hans-SG,zh-Hant,zh-Hant-CN,zh-Hant-HK,zh-Hant-MO,zh-Hant-TW,zh-Latn,zh-Latn-pinyin,zu,zun,zza

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
