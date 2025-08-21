.PHONY: build deps viewer jekyll serve

build: deps viewer jekyll

deps:
	cd viewer && npm install
	bundle install

viewer:
	cd viewer && npm run build
	cp viewer/dist/viewer.js assets/viewer.js
	cp viewer/dist/viewer.css assets/viewer.css

jekyll:
	bundle exec jekyll build

serve: viewer
	bundle exec jekyll serve --incremental

clean:
	cd viewer && npm run clean
	rm -rf _site
	rm -f assets/viewer.js assets/viewer.css
