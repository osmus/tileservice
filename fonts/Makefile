.PHONY: build upload

build:
	# build_pbf_glyphs is from https://github.com/stadiamaps/sdf_font_tools
	build_pbf_glyphs ttf/ build/

upload:
	# rclone.conf does not exist in this repository; to upload fonts you need
	# to create your own API key and conf file.
	rclone copy --config ./rclone.conf build/ osmus-r2://osmus-tile/fonts/
