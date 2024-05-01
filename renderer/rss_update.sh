#!/bin/bash

# Check for input parameter (the message to be added)
if [ $# -lt 1 ]; then
    echo "Usage: $0 <message>"
    exit 1
fi

RSS_FILE=$1
TITLE=$2
MESSAGE=$3
CURRENT_DATE=$(date +"%Y-%m-%dT%H:%M:%SZ")

# Escape HTML special characters in the message
MESSAGE=$(echo "$MESSAGE" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'"'"'/\&apos;/g')

# Check if the RSS file exists
if [ -f "$RSS_FILE" ]; then
    # Get the size of the RSS file
    FILE_SIZE=$(stat -c%s "$RSS_FILE")

    # If the size of the RSS file is more than 100KB, remove it
    if [ "$FILE_SIZE" -gt 102400 ]; then
      echo "The RSS file is larger than 100KB. Removing the file..."
      rm "$RSS_FILE"
    fi
fi

# If the RSS file doesn't exist, create a new one
if [ ! -f "$RSS_FILE" ]; then
    echo '<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
    <author><name>Brian Sperlongano</name></author>
    <title type="text">tile.ourmap.us Planet Build</title>
    <link>https://tile.ourmap.us/</link>
    <description>Planet build status</description>
</channel>
</rss>' > "$RSS_FILE"
fi

# Read the URL from /tmp/seashells_render and extract it using grep
URL=$(grep -o 'https://[^ ]*' /tmp/seashells_render)

# Add the new item entry to the RSS file
xmlstarlet ed --inplace \
    -s "//channel" -t elem -n "item" -v "" \
    -s "//channel/item[last()]" -t elem -n "title" -v "$TITLE" \
    -s "//channel/item[last()]" -t elem -n "author" -v "zelonewolf@gmail.com" \
    -s "//channel/item[last()]" -t elem -n "link" -v "$URL" \
    -s "//channel/item[last()]" -t elem -n "pubDate" -v "$CURRENT_DATE" \
    -s "//channel/item[last()]" -t elem -n "content:encoded" -v "$MESSAGE" \
    -i "//channel/item[last()]/content:encoded" -t attr -n "type" -v "html" \
    "$RSS_FILE"

echo "New entry added to $RSS_FILE"
aws s3 cp "$RSS_FILE" s3://tileserver-static/